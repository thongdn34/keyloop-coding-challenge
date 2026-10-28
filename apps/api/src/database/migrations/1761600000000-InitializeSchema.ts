import { MigrationInterface, QueryRunner } from "typeorm";

export class InitializeSchema1761600000000 implements MigrationInterface {
  name = "InitializeSchema1761600000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dealership" (
        "id" SERIAL PRIMARY KEY,
        "name" character varying NOT NULL,
        "city" character varying NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "customer" (
        "id" SERIAL PRIMARY KEY,
        "name" character varying NOT NULL,
        "email" character varying NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "service_type" (
        "id" SERIAL PRIMARY KEY,
        "name" character varying NOT NULL,
        "durationMinutes" integer NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "vehicle" (
        "id" SERIAL PRIMARY KEY,
        "customerId" integer NOT NULL,
        "make" character varying NOT NULL,
        "model" character varying NOT NULL,
        "registration" character varying NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "service_bay" (
        "id" SERIAL PRIMARY KEY,
        "dealershipId" integer NOT NULL,
        "name" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS "technician" (
        "id" SERIAL PRIMARY KEY,
        "dealershipId" integer NOT NULL,
        "name" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS "technician_skill" (
        "id" SERIAL PRIMARY KEY,
        "technicianId" integer NOT NULL,
        "serviceTypeId" integer NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "appointment" (
        "id" SERIAL PRIMARY KEY,
        "dealershipId" integer NOT NULL,
        "customerId" integer NOT NULL,
        "vehicleId" integer NOT NULL,
        "serviceTypeId" integer NOT NULL,
        "technicianId" integer NOT NULL,
        "serviceBayId" integer NOT NULL,
        "startAt" timestamptz NOT NULL,
        "endAt" timestamptz NOT NULL,
        "status" character varying NOT NULL DEFAULT 'confirmed'
      );
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_vehicle_customer') THEN
          ALTER TABLE "vehicle" ADD CONSTRAINT "FK_vehicle_customer"
            FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_service_bay_dealership') THEN
          ALTER TABLE "service_bay" ADD CONSTRAINT "FK_service_bay_dealership"
            FOREIGN KEY ("dealershipId") REFERENCES "dealership"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_technician_dealership') THEN
          ALTER TABLE "technician" ADD CONSTRAINT "FK_technician_dealership"
            FOREIGN KEY ("dealershipId") REFERENCES "dealership"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_technician_skill_technician') THEN
          ALTER TABLE "technician_skill" ADD CONSTRAINT "FK_technician_skill_technician"
            FOREIGN KEY ("technicianId") REFERENCES "technician"("id") ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_technician_skill_service') THEN
          ALTER TABLE "technician_skill" ADD CONSTRAINT "FK_technician_skill_service"
            FOREIGN KEY ("serviceTypeId") REFERENCES "service_type"("id") ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_appointment_dealership') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "FK_appointment_dealership"
            FOREIGN KEY ("dealershipId") REFERENCES "dealership"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_appointment_customer') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "FK_appointment_customer"
            FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_appointment_vehicle') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "FK_appointment_vehicle"
            FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_appointment_service') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "FK_appointment_service"
            FOREIGN KEY ("serviceTypeId") REFERENCES "service_type"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_appointment_technician') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "FK_appointment_technician"
            FOREIGN KEY ("technicianId") REFERENCES "technician"("id") ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_appointment_bay') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "FK_appointment_bay"
            FOREIGN KEY ("serviceBayId") REFERENCES "service_bay"("id") ON DELETE RESTRICT;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_technician_skill"
        ON "technician_skill" ("technicianId", "serviceTypeId");
      CREATE INDEX IF NOT EXISTS "IDX_appointment_dealership_interval"
        ON "appointment" ("dealershipId", "startAt", "endAt")
        WHERE "status" = 'confirmed';
      CREATE INDEX IF NOT EXISTS "IDX_appointment_bay_interval"
        ON "appointment" ("serviceBayId", "startAt", "endAt")
        WHERE "status" = 'confirmed';
      CREATE INDEX IF NOT EXISTS "IDX_appointment_technician_interval"
        ON "appointment" ("technicianId", "startAt", "endAt")
        WHERE "status" = 'confirmed';
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_service_duration_positive') THEN
          ALTER TABLE "service_type" ADD CONSTRAINT "CHK_service_duration_positive"
            CHECK ("durationMinutes" > 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_appointment_interval') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "CHK_appointment_interval"
            CHECK ("endAt" > "startAt");
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_appointment_status') THEN
          ALTER TABLE "appointment" ADD CONSTRAINT "CHK_appointment_status"
            CHECK ("status" IN ('confirmed', 'cancelled'));
        END IF;
      END
      $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "appointment" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "technician_skill" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "technician" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "service_bay" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "vehicle" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "service_type" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "customer" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "dealership" CASCADE');
  }
}
