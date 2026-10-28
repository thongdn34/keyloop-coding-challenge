import { MigrationInterface, QueryRunner } from "typeorm";

export class HardenForTheFuture1761700000000 implements MigrationInterface {
  name = "HardenForTheFuture1761700000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_user" (
        "id" SERIAL PRIMARY KEY,
        "username" character varying NOT NULL,
        "passwordHash" character varying NOT NULL,
        "role" character varying NOT NULL,
        "dealershipId" integer
      );
      CREATE TABLE IF NOT EXISTS "idempotency_record" (
        "key" character varying(128) PRIMARY KEY,
        "requestHash" character varying(64) NOT NULL,
        "response" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_app_user_dealership') THEN
          ALTER TABLE "app_user" ADD CONSTRAINT "FK_app_user_dealership"
            FOREIGN KEY ("dealershipId") REFERENCES "dealership"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_app_user_role_scope') THEN
          ALTER TABLE "app_user" ADD CONSTRAINT "CHK_app_user_role_scope"
            CHECK (
              ("role" = 'coordinator' AND "dealershipId" IS NULL)
              OR ("role" = 'advisor' AND "dealershipId" IS NOT NULL)
            );
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EXCL_appointment_bay') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "EXCL_appointment_bay"
            EXCLUDE USING gist (
              "serviceBayId" WITH =,
              tstzrange("startAt", "endAt", '[)') WITH &&
            ) WHERE ("status" = 'confirmed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EXCL_appointment_technician') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "EXCL_appointment_technician"
            EXCLUDE USING gist (
              "technicianId" WITH =,
              tstzrange("startAt", "endAt", '[)') WITH &&
            ) WHERE ("status" = 'confirmed');
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_app_user_username"
        ON "app_user" ("username");
      CREATE INDEX IF NOT EXISTS "IDX_service_bay_active_dealer"
        ON "service_bay" ("dealershipId", "id") WHERE "active";
      CREATE INDEX IF NOT EXISTS "IDX_technician_active_dealer"
        ON "technician" ("dealershipId", "id") WHERE "active";
      CREATE INDEX IF NOT EXISTS "IDX_technician_skill_service"
        ON "technician_skill" ("serviceTypeId", "technicianId");
      CREATE INDEX IF NOT EXISTS "IDX_appointment_history"
        ON "appointment" ("dealershipId", "startAt", "id");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointment" DROP CONSTRAINT IF EXISTS "EXCL_appointment_bay"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment" DROP CONSTRAINT IF EXISTS "EXCL_appointment_technician"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_record"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "app_user"`);
  }
}
