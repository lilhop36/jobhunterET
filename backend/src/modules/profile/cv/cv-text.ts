import { BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as path from 'path';

/**
 * Plain-text extraction for uploaded documents (Phase 5).
 *
 * The upload endpoint already validates magic bytes, so this only has to deal
 * with the two formats we accept. Anything else is rejected with a message the
 * candidate can act on — a scanned PDF is the most common case, and pretending
 * it parsed would waste their time.
 */
export async function extractCvText(buffer: Buffer, originalName: string): Promise<string> {
  const ext = path.extname(originalName || '').toLowerCase();

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const { text } = await parser.getText();
      const cleaned = (text || '').trim();
      if (cleaned.replace(/\s/g, '').length < 40) {
        throw new BadRequestException(
          'This PDF has almost no readable text — it is probably a scan. Upload a text-based PDF/DOCX or fill the profile manually.',
        );
      }
      return cleaned;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'Could not read this PDF. Try re-exporting it as DOCX or fill the profile manually.',
      );
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  if (ext === '.docx') {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      const cleaned = (value || '').trim();
      if (cleaned.replace(/\s/g, '').length < 40) {
        throw new BadRequestException('This DOCX appears to be empty.');
      }
      return cleaned;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Could not read this DOCX file.');
    }
  }

  throw new BadRequestException('Only .pdf or .docx CVs can be imported.');
}
