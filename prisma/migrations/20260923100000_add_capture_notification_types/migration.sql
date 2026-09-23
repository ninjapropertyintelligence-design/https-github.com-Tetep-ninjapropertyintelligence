-- Adds the capture-review notification types.
--
-- Submitting a site and reviewing one previously told nobody: staff learned a
-- site was waiting by opening the job page, and a vendor learned it had been
-- rejected the same way. A rejection nobody sees is a job that stalls.
--
-- New values rather than reusing PROCESSING_COMPLETED: these are not
-- processing, and a notification type that lies makes every later filter and
-- digest wrong.
--
-- BEFORE 'REPORT_READY' keeps the declared order in schema.prisma and the
-- physical order in the type identical.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CAPTURE_SUBMITTED' BEFORE 'REPORT_READY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CAPTURE_ACCEPTED' BEFORE 'REPORT_READY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CAPTURE_REJECTED' BEFORE 'REPORT_READY';
