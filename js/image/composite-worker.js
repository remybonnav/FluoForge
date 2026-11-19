/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Compositing worker (module worker). Runs js/image/composite-core.js off the main thread.

   Messages from the page:
     { id, type: 'composite', job }   job as for compositeImage(); each channel (and the alpha plane)
                                      carries `key`, and `data` unless the page believes the resampled
                                      plane is cached here. Replies { id, rgba } (transferred), or
                                      { id, miss: [keys] } when a plane without data is not cached.
     { id, type: 'project', zs, mode } replies { id, plane } (transferred): a Z projection.
     { id, type: 'histogram', plane }  replies { id, histogram } (counts transferred): planeHistogram().
   Resampled planes of preview jobs (job.cache) are kept, least recently used first out, up to
   CACHE_BYTES, so a change of display settings sends no pixel data at all. */
import { compositeImage, resamplePlane, projectPlanes, planeHistogram } from './composite-core.js';

const CACHE_BYTES = 384 * 1024 * 1024;
const cache = new Map();
let cachedBytes = 0;

function remember(key, value) {
  if (cache.has(key)) return;
  cache.set(key, value);
  cachedBytes += value.data.byteLength + (value.coverage ? value.coverage.byteLength : 0);
  for (const [k, v] of cache) {
    if (cachedBytes <= CACHE_BYTES || k === key) break;
    cache.delete(k); cachedBytes -= v.data.byteLength + (v.coverage ? v.coverage.byteLength : 0);
  }
}

function composite(job) {
  const geometry = `${job.srcW}x${job.srcH}|${job.region.x},${job.region.y},${job.region.width},${job.region.height}|${job.dstW}x${job.dstH}|${job.rows ? job.rows.join('-') : 'all'}`;
  const planes = [...job.channels.filter(c => c.enabled), ...(job.alpha ? [job.alpha] : [])];
  const missing = planes.filter(p => !p.data && !cache.has(p.key + '|' + geometry)).map(p => p.key);
  if (missing.length) return { miss: missing };
  // compositeImage hands each channel's `data` to resample(); here that is the plane object
  // itself ({ key, data? }), so a cached plane needs no pixels.
  const resample = plane => {
    const key = plane.key + '|' + geometry;
    let r = cache.get(key);
    if (r) { cache.delete(key); cache.set(key, r); return r; } // most recently used last
    r = resamplePlane(plane.data, job.srcW, job.srcH, job.region, job.dstW, job.dstH, job.rows, job.dataRow0 || 0);
    if (job.cache) remember(key, r);
    return r;
  };
  const channels = job.channels.map(c => ({ ...c, data: c }));
  return { rgba: compositeImage({ ...job, channels, alpha: job.alpha || null }, resample) };
}

self.onmessage = ({ data: message }) => {
  try {
    if (message.type === 'composite') {
      const started = performance.now();
      const result = composite(message.job);
      if (result.miss) self.postMessage({ id: message.id, miss: result.miss });
      else self.postMessage({ id: message.id, rgba: result.rgba, ms: performance.now() - started }, [result.rgba.buffer]);
    } else if (message.type === 'project') {
      const plane = projectPlanes(message.zs, message.mode);
      self.postMessage({ id: message.id, plane }, [plane.buffer]);
    } else if (message.type === 'histogram') {
      const histogram = planeHistogram(message.plane);
      self.postMessage({ id: message.id, histogram }, [histogram.counts.buffer]);
    } else if (message.type === 'forget') {
      for (const key of [...cache.keys()]) if (message.keys.some(k => key.startsWith(k + '|'))) {
        const v = cache.get(key); cache.delete(key); cachedBytes -= v.data.byteLength + (v.coverage ? v.coverage.byteLength : 0);
      }
    }
  } catch (error) {
    self.postMessage({ id: message.id, error: error.message || String(error) });
  }
};
