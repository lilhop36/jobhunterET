import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDraftDto {
  @IsString()
  jobId: string;

  @IsOptional()
  @IsInt()
  packageVersion?: number;
}

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(60000)
  cv?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30000)
  coverLetter?: string;

  /** Full replacement list of { question, answer, basis }. */
  @IsOptional()
  @IsArray()
  screeningAnswers?: any[];

  /** Full replacement list of profile document ids to attach. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

  /** Candidate confirms edited content is accurate. */
  @IsOptional()
  @IsBoolean()
  attestation?: boolean;
}

export class ApproveDraftDto {
  /** The content hash the candidate reviewed; approval binds to it. */
  @IsString()
  contentHash: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
