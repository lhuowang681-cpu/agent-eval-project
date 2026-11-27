import { describe, expect, it } from 'vitest';

import { isExecutionTime } from './cronEval';

const SHANGHAI = 'Asia/Shanghai';

const utc = (iso: string) => new Date(`${iso}Z`);
/** Build a UTC `Date` representing the given local wall-clock time in Shanghai (UTC+8). */
const shanghaiLocal = (iso: string) => new Date(`${iso}+08:00`);

describe('isExecutionTime', () => {
  describe('daily pattern — manual-trigger-before-scheduled-tick (regression)', () => {
    // Bug: when a user manually triggers a scheduled task earlier in the day,
    // `lastHeartbeatAt` advances. The dispatcher used to dedup by "same
    // calendar day", which made it skip the scheduled tick later that same
    // day. The fix is to dedup against today's scheduled target time, so a
    // pre-target manual run no longer eats the upcoming tick.

    it('fires daily 21:00 tick even if user manually triggered at 18:00 (UTC)', () => {
      // Daily at 21:00 UTC; manual run earlier today at 18:00.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: utc('2026-04-29T18:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('fires daily 21:00 tick if manual trigger was at 18:00 local Shanghai', () => {
      // Same scenario but in Asia/Shanghai timezone.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: shanghaiLocal('2026-04-29T21:00:00'),
          lastExecutedAt: shanghaiLocal('2026-04-29T18:00:00'),
          timezone: SHANGHAI,
        }),
      ).toBe(true);
    });

    it('fires the 7:30 daily tick when manual trigger happened at 06:00 same morning', () => {
      expect(
        isExecutionTime({
          cronPattern: '30 7 * * *',
          currentTime: utc('2026-04-29T07:30:00'),
          lastExecutedAt: utc('2026-04-29T06:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('daily pattern — dedup must still hold', () => {
    it('does NOT re-fire 30 minutes after the scheduled tick already ran', () => {
      // Scheduled tick fired at 21:00; dispatcher checks again at 21:30.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:30:00'),
          lastExecutedAt: utc('2026-04-29T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('does NOT fire if user manually ran AFTER the scheduled target same day', () => {
      // Manual run at 22:00 covers today's 21:00 scheduled run; do not refire.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T22:30:00'),
          lastExecutedAt: utc('2026-04-29T22:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('fires next day at 21:00 after running yesterday at 21:00', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-30T21:00:00'),
          lastExecutedAt: utc('2026-04-29T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('daily pattern — catch-up after missed scheduled time', () => {
    it('catches up at 23:00 if 21:00 was missed and the task never ran today', () => {
      // Last run was yesterday at 21:00; dispatcher comes online at 23:00 today.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T23:00:00'),
          lastExecutedAt: utc('2026-04-28T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('does NOT catch-up after manual run already covered today (manual at 22:00, dispatcher at 23:00)', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T23:00:00'),
          lastExecutedAt: utc('2026-04-29T22:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('hourly / interval patterns', () => {
    it('every-hour-at-:00 fires a new slot even if the previous run finished 30 min into the hour', () => {
      // Last run *completed* at 14:30 (e.g. it took a while to finish) — 15:00
      // is still a distinct, not-yet-executed slot and must fire.
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:00:00'),
          lastExecutedAt: utc('2026-04-29T14:30:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('every-hour-at-:00 dedups against the same slot re-checked shortly after', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:05:00'),
          lastExecutedAt: utc('2026-04-29T15:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('every-hour-at-:00 fires after 60 minutes since last run', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:00:00'),
          lastExecutedAt: utc('2026-04-29T14:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('*/30 pattern dedups within its 30-minute window', () => {
      expect(
        isExecutionTime({
          cronPattern: '*/30 * * * *',
          currentTime: utc('2026-04-29T15:15:00'),
          lastExecutedAt: utc('2026-04-29T15:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('*/30 pattern fires the next slot even if the previous run finished late', () => {
      // Previous 15:00 slot took 20 minutes to finish (heartbeat at 15:20) —
      // the 15:30 slot must still fire, not get skipped until 16:00.
      expect(
        isExecutionTime({
          cronPattern: '*/30 * * * *',
          currentTime: utc('2026-04-29T15:30:00'),
          lastExecutedAt: utc('2026-04-29T15:20:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('hourly pattern — slow execution must not double the effective interval (regression)', () => {
    // Bug: dedup used to be a sliding "minutesSince < 60" window measured
    // against the *real* last-heartbeat timestamp. Since a task's heartbeat is
    // written when it *finishes* (not at the scheduled target minute), any
    // non-zero execution duration `d` pushed the baseline to target+d — which
    // made the very next hourly tick fail the `< 60` check and get skipped,
    // so a "every hour at :30" task only ever fired every 2 hours.
    it('fires the next hourly tick even if the previous run finished mid-window', () => {
      expect(
        isExecutionTime({
          cronPattern: '30 * * * *',
          currentTime: utc('2026-04-29T15:30:00'),
          lastExecutedAt: utc('2026-04-29T14:50:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('still dedups if re-checked shortly after the same slot fired', () => {
      expect(
        isExecutionTime({
          cronPattern: '30 * * * *',
          currentTime: utc('2026-04-29T15:35:00'),
          lastExecutedAt: utc('2026-04-29T15:32:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('every-N-hours pattern — slow execution must not double the effective interval (regression)', () => {
    it('fires the next 2-hour tick even if the previous run finished mid-window', () => {
      // Pattern "0 */2 * * *" fires at even hours. Previous 14:00 slot took 20
      // minutes (heartbeat at 14:20) — 16:00 must still fire, not get pushed
      // out to 18:00.
      expect(
        isExecutionTime({
          cronPattern: '0 */2 * * *',
          currentTime: utc('2026-04-29T16:00:00'),
          lastExecutedAt: utc('2026-04-29T14:20:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('dedups within the same 2-hour slot', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 */2 * * *',
          currentTime: utc('2026-04-29T14:30:00'),
          lastExecutedAt: utc('2026-04-29T14:05:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('weekly pattern', () => {
    it('weekly Wed 21:00: fires Wednesday after manual Wed-morning trigger', () => {
      // 2026-04-29 is a Wednesday (weekday=3).
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * 3',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: utc('2026-04-29T08:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('weekly Wed 21:00: does NOT fire on Thursday', () => {
      // 2026-04-30 is Thursday.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * 3',
          currentTime: utc('2026-04-30T21:00:00'),
          lastExecutedAt: utc('2026-04-22T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('null / first-run handling', () => {
    it('fires when there is no lastExecutedAt and clock matches', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: null,
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });
});
