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
  Res,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
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
const DOCUMENT_KINDS = ['CV', 'CERTIFICATE', 'PORTFOLIO', 'OTHER'];
const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Shared upload guard: extension, declared MIME, then magic bytes (SEC-003). */
const uploadOptions = {
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowedExt = ['.pdf', '.docx'];
    const ext = (file.originalname || '').toLowerCase().slice((file.originalname || '').lastIndexOf('.'));
    if (!allowedExt.includes(ext) || !ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new BadRequestException('Only .pdf or .docx files are allowed'), false);
    }
    cb(null, true);
  },
};

/** Persist an uploaded buffer under the user's own folder and record it. */
async function storeUpload(
  prisma: PrismaService,
  userId: string,
  file: any,
  kind: string,
  label?: string,
) {
  if (!file) throw new BadRequestException('No file provided');
  if (file.size > MAX_BYTES) throw new BadRequestException('File exceeds the size limit');

  const magic = file.buffer?.subarray(0, 4);
  const isPdf = magic && magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46; // %PDF
  const isDocx = magic && magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04; // PK..ZIP (docx is a zip)
  if (!isPdf && !isDocx) throw new BadRequestException('Only .pdf or .docx allowed (magic-byte check failed)');

  const dir = path.join(CV_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${(file.originalname || 'file').replace(/[^\w.\-]/g, '_')}`;
  const full = path.join(dir, stamp);
  fs.writeFileSync(full, file.buffer);

  return prisma.cvFile.create({
    data: {
      userId,
      filePath: full,
      originalName: file.originalname,
      sizeBytes: file.size,
      kind,
      label: label?.trim() ? label.trim().slice(0, 120) : null,
    },
  });
}

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
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async uploadCv(@CurrentUser() user: AuthUser, @UploadedFile() file: any) {
    // A new CV supersedes the old one so "the active CV" stays unambiguous.
    await this.prisma.cvFile.updateMany({
      where: { userId: user.id, kind: 'CV', active: this.prisma.bool(true) as any },
      data: { active: this.prisma.bool(false) as any },
    });
    const rec = await storeUpload(this.prisma, user.id, file, 'CV');
    return {
      id: rec.id,
      originalName: rec.originalName,
      sizeBytes: rec.sizeBytes,
      uploadedAt: rec.uploadedAt,
      downloadUrl: '/api/profile/cv/download',
    };
  }

  @Post('cv/import')
  importCv(@CurrentUser() user: AuthUser) {
    return this.profile.importCv(user.id);
  }

  @Get('cv')
  async getCv(@CurrentUser() user: AuthUser) {
    const cv = await this.prisma.cvFile.findFirst({
      where: { userId: user.id, active: this.prisma.bool(true) as any, kind: 'CV' },
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

  /** Download the active CV — ownership enforced via the JWT user. */
  @Get('cv/download')
  async downloadCv(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const cv = await this.prisma.cvFile.findFirst({
      where: { userId: user.id, active: this.prisma.bool(true) as any, kind: 'CV' },
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
    // SEC-004: sanitize filename for Content-Disposition — strip all non-ASCII and special chars.
    const safeName = cv.originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.sendFile(path.resolve(cv.filePath));
  }

  @Delete('cv')
  async deleteCv(@CurrentUser() user: AuthUser) {
    await this.prisma.cvFile.updateMany({
      where: { userId: user.id, kind: 'CV', active: this.prisma.bool(true) as any },
      data: { active: this.prisma.bool(false) as any },
    });
    return { ok: true };
  }

  // ── Supporting documents (Phase 5) ─────────────────────────────────────────

  @Get('documents')
  listDocuments(@CurrentUser() user: AuthUser) {
    return this.profile.listDocuments(user.id);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async uploadDocument(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: any,
    @Body() body: { kind?: string; label?: string },
  ) {
    const kind = (body?.kind || 'OTHER').toUpperCase();
    if (!DOCUMENT_KINDS.includes(kind)) {
      throw new BadRequestException(`kind must be one of ${DOCUMENT_KINDS.join(', ')}`);
    }
    // Only one CV slot: a CV uploaded here replaces the previous active one.
    if (kind === 'CV') {
      await this.prisma.cvFile.updateMany({
        where: { userId: user.id, kind: 'CV', active: this.prisma.bool(true) as any },
        data: { active: this.prisma.bool(false) as any },
      });
    }
    const rec = await storeUpload(this.prisma, user.id, file, kind, body?.label);
    return {
      id: rec.id,
      kind: rec.kind,
      label: rec.label,
      originalName: rec.originalName,
      sizeBytes: rec.sizeBytes,
      uploadedAt: rec.uploadedAt,
      downloadUrl: `/api/profile/documents/${rec.id}/download`,
    };
  }

  @Get('documents/:id/download')
  async downloadDocument(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.prisma.cvFile.findFirst({
      where: { id, userId: user.id, active: this.prisma.bool(true) as any },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (!fs.existsSync(doc.filePath)) throw new NotFoundException('Document file missing on disk');
    const ext = path.extname(doc.originalName).toLowerCase();
    res.setHeader(
      'Content-Type',
      ext === '.pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const safeName = doc.originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.sendFile(path.resolve(doc.filePath));
  }

  @Delete('documents/:id')
  deleteDocument(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profile.deleteDocument(user.id, id);
  }
}
