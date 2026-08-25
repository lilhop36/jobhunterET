import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SearchesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.searchProfile.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  create(userId: string, dto: { name: string; q?: string; tier?: string; remote?: boolean }) {
    return this.prisma.searchProfile.create({
      data: { userId, name: dto.name, q: dto.q, tier: dto.tier || 'ALL', remote: this.prisma.bool(dto.remote ?? false) as any },
    });
  }

  remove(userId: string, id: string) {
    return this.prisma.searchProfile.deleteMany({ where: { id, userId } });
  }
}
