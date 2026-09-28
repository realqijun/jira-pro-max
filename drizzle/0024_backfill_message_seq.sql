-- Existing rows got `seq` in storage order. Re-derive thread order: by created_at, and within one
-- save (same created_at) the user Message before the assistant reply it produced.
UPDATE "messages" AS m
SET "seq" = o."rn"
FROM (
  SELECT "conversation_id", "id",
    row_number() OVER (ORDER BY "created_at", CASE "role" WHEN 'user' THEN 0 ELSE 1 END, "id") AS "rn"
  FROM "messages"
) AS o
WHERE m."conversation_id" = o."conversation_id" AND m."id" = o."id";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('messages', 'seq'), COALESCE((SELECT max("seq") FROM "messages"), 0) + 1, false);
