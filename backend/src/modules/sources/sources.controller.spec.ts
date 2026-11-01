import { ConflictException } from '@nestjs/common';
import { SourcesController } from './sources.controller';

/**
 * FR-010 (SRS §13): the manual collection endpoint is admin-only, asynchronous,
 * and answers HTTP 409 when that source already has a run in progress.
 */
describe('SourcesController — FR-010 manual collection', () => {
  const makeController = (enqueueCollect: jest.Mock) => {
    const sources: any = { enqueueCollect };
    return { controller: new SourcesController(sources), enqueueCollect };
  };

  it('maps a source already in flight to ConflictException (409)', () => {
    const { controller } = makeController(
      jest.fn().mockReturnValue({ enqueued: false, conflict: true, message: 'reliefweb collection is already running' }),
    );
    expect(() => controller.collect('reliefweb')).toThrow(ConflictException);
    expect(() => controller.collect('reliefweb')).toThrow('reliefweb collection is already running');
  });

  it('applies the same rule to the deep-collection trigger', () => {
    const { controller } = makeController(
      jest.fn().mockReturnValue({ enqueued: false, conflict: true, message: 'ethiojobs collection is already running' }),
    );
    expect(() => controller.collectDeep('ethiojobs')).toThrow(ConflictException);
  });

  it('returns the queue acknowledgement when nothing is running', () => {
    const ack = { enqueued: true, message: 'reliefweb queued for collection' };
    const { controller, enqueueCollect } = makeController(jest.fn().mockReturnValue(ack));
    expect(controller.collect('reliefweb')).toEqual(ack);
    expect(enqueueCollect).toHaveBeenCalledWith('reliefweb');
  });

  it('is admin-only at the controller boundary', () => {
    const roles = Reflect.getMetadata('roles', SourcesController);
    const guards = Reflect.getMetadata('__guards__', SourcesController);
    expect(roles).toEqual(['ADMIN']);
    expect(guards).toHaveLength(2);
  });
});
