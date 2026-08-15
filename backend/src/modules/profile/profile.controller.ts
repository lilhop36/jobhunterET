import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Param,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/profile.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const CV_DIR = process.env.CV_UPLOAD_DIR || './uploads/cv';
const MAX_BYTES = (Number(process.env.CV_MAX_SIZE_MB) || 5) * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.profile.getProfile(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profile.updateProfile(user.id, dto);
  }

  @Post('cv')
  @UseInterceptors(FileInterceptor('file'))
  async uploadCv(@CurrentUser() user: AuthUser, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file provided');
    const okType = /\.(pdf|docx)$/i.test(file.originalname);
    if (!okType) throw new BadRequestException('Only .pdf or .docx allowed');
    if (file.size > MAX_BYTES) throw new BadRequestException('File exceeds 5 MB limit');

    const dir = path.join(CV_DIR, user.id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = `${Date.now()}-${file.originalname.replace(/[^\w.\-]/g, '_')}`;
    const full = path.join(dir, stamp);
    fs.writeFileSync(full, file.buffer);

    const rec = await this.prisma.cvFile.create({
      data: {
        userId: user.id,
        filePath: full,
        originalName: file.originalname,
        sizeBytes: file.size,
      },
    });
    return {
      id: rec.id,
      originalName: rec.originalName,
      sizeBytes: rec.sizeBytes,
      uploadedAt: rec.uploadedAt,
      downloadUrl: '/api/profile/cv/download',
    };
  }

  @Get('cv')
  async getCv(@CurrentUser() user: AuthUser) {
    const cv = await this.prisma.cvFile.findFirst({
      where: { userId: user.id, active: true },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!cv) return null;
    return {
      id: cv.id,
      originalName: cv.originalName,
      sizeBytes: cv.sizeBytes,
      uploadedAt: cv.uploadedAt,
      downloadUrl: '/api/profile/cv/download',
    };
  }

  /** FR-003a / NFR-005: download the active CV — ownership enforced via the JWT user. */
  @Get('cv/download')
  async downloadCv(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const cv = await this.prisma.cvFile.findFirst({
      where: { userId: user.id, active: true },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!cv) throw new NotFoundException('No CV uploaded');
    if (!fs.existsSync(cv.filePath)) throw new NotFoundException('CV file missing on disk');
    const ext = path.extname(cv.originalName).toLowerCase();
    const type =
      ext === '.pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${cv.originalName.replace(/"/g, '')}"`);
    res.sendFile(path.resolve(cv.filePath));
  }

  @Delete('cv')
  async deleteCv(@CurrentUser() user: AuthUser) {
    await this.prisma.cvFile.updateMany({
      where: { userId: user.id, active: true },
      data: { active: false },
    });
    return { ok: true };
  }
}
