import { IsOptional, IsString, IsInt, IsArray, IsBoolean } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsInt() years?: number;
  @IsOptional() @IsBoolean() remote?: boolean;
  @IsOptional() @IsInt() minSalary?: number;
  @IsOptional() @IsBoolean() excludeOnsite?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsArray() targetRoles?: { role: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  @IsOptional() @IsArray() locationTiers?: { region: string; tier: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  @IsOptional() @IsArray() @IsString({ each: true }) employmentTypes?: string[];
  @IsOptional() @IsBoolean() onboardDone?: boolean;

  /** Core matching attributes — changing any of these triggers recalc (FR-003e). */
  static CORE_KEYS = ['skills', 'targetRoles', 'locationTiers', 'remote', 'employmentTypes'] as const;
}
