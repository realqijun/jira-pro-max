-- Tokens issued before the PrismPM rename (`vtg_`) no longer authenticate; mark them revoked so Settings shows them as such.
UPDATE "api_tokens" SET "revoked_at" = now() WHERE "prefix" LIKE 'vtg\_%' AND "revoked_at" IS NULL;
