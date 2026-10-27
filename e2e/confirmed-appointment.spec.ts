import { expect, test } from "@playwright/test";
import {
  byName,
  confirmAppointment,
  freeSlot,
  listAppointments,
  expectSameInstant,
  loadCatalog,
  openBooking,
  requestAppointment,
  vehicleNamed,
} from "./support";

test.describe("confirmed appointment record", () => {
  test("stores a confirmed appointment for the checked bay, technician, and visit", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const dealership = byName(catalog.dealerships, "Riverside Motors");
    const vehicle = vehicleNamed(catalog, "Honda", "Civic");
    const service = byName(catalog.services, "Oil & filter change");
    const when = await freeSlot(request, service.durationMinutes ?? 60);

    const { request: body, availability } = await requestAppointment(page, {
      dealership: dealership.name,
      vehicle: /Honda Civic/,
      service: service.name,
      when,
    });
    expect(availability.available).toBe(true);
    expectSameInstant(body.startAt, when);

    const saved = await confirmAppointment(page);

    expect(saved).toMatchObject({
      dealershipId: dealership.id,
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      serviceTypeId: service.id,
      technicianId: availability.technician?.id,
      serviceBayId: availability.serviceBay?.id,
      status: "confirmed",
    });
    expect(new Date(saved.startAt).toISOString()).toBe(availability.startAt);
    expect(new Date(saved.endAt).toISOString()).toBe(availability.endAt);
    expect(
      new Date(saved.endAt).getTime() - new Date(saved.startAt).getTime(),
    ).toBe((service.durationMinutes ?? 0) * 60_000);

    await expect(page.getByRole("status")).toContainText(
      `Booking ${saved.id} is saved.`,
    );
    const diary = page.locator(".booking.fresh");
    await expect(diary).toContainText("Honda Civic");
    await expect(diary).toContainText("59A-67890");
    await expect(diary).toContainText(service.name);
    await expect(diary).toContainText(dealership.name);
    await expect(diary.getByText("Just booked")).toBeVisible();
    await expect(diary.locator("time.when")).toHaveAttribute(
      "datetime",
      new Date(saved.startAt).toISOString(),
    );

    const persisted = (await listAppointments(request)).find(
      (item) => item.id === saved.id,
    );
    expect(persisted).toMatchObject({
      status: "confirmed",
      dealershipId: saved.dealershipId,
      vehicleId: saved.vehicleId,
      serviceTypeId: saved.serviceTypeId,
      technicianId: saved.technicianId,
      serviceBayId: saved.serviceBayId,
      customerId: saved.customerId,
    });
  });

  test("keeps the confirmed appointment after a reload", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const dealership = byName(catalog.dealerships, "Central Auto Service");
    const vehicle = vehicleNamed(catalog, "Toyota", "Corolla");
    const service = byName(catalog.services, "Brake inspection");
    const when = await freeSlot(request, service.durationMinutes ?? 90);

    await requestAppointment(page, {
      dealership: dealership.name,
      vehicle: /Toyota Corolla/,
      service: service.name,
      when,
    });
    const saved = await confirmAppointment(page);
    await expect(page.getByRole("status")).toContainText(
      `Booking ${saved.id} is saved.`,
    );

    const listed = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/appointments") &&
        response.ok(),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const appointments = (await (await listed).json()) as Array<{
      id: number;
      status: string;
      startAt: string;
      endAt: string;
      vehicleId: number;
      serviceTypeId: number;
      technicianId: number;
      serviceBayId: number;
    }>;
    const reloaded = appointments.find((item) => item.id === saved.id);
    expect(reloaded).toMatchObject({
      status: "confirmed",
      vehicleId: vehicle.id,
      serviceTypeId: service.id,
      technicianId: saved.technicianId,
      serviceBayId: saved.serviceBayId,
    });
    expect(new Date(reloaded?.startAt ?? "").toISOString()).toBe(
      new Date(saved.startAt).toISOString(),
    );
    expect(new Date(reloaded?.endAt ?? "").toISOString()).toBe(
      new Date(saved.endAt).toISOString(),
    );

    await openBooking(page);
    const card = page.locator(".booking").filter({
      has: page.locator(
        `time.when[datetime="${new Date(saved.startAt).toISOString()}"]`,
      ),
    });
    await expect(card).toContainText("Toyota Corolla");
    await expect(card).toContainText(vehicle.registration ?? "");
    await expect(card).toContainText(service.name);
    await expect(card).toContainText(dealership.name);
    await expect(card.getByText("Upcoming")).toBeVisible();
  });
});
