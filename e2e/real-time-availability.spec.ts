import { expect, test } from "@playwright/test";
import {
  addMinutes,
  bookApi,
  byName,
  checkAvailability,
  chooseService,
  chooseWorkshop,
  expectSameInstant,
  freeSlot,
  listAppointments,
  loadCatalog,
  openBooking,
  requestAppointment,
  vehicleNamed,
  withOffset,
} from "./support";

test.describe("real-time availability check", () => {
  test("finds a free bay and qualified technician for the whole visit before confirming", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const dealership = byName(catalog.dealerships, "Central Auto Service");
    const service = byName(catalog.services, "Oil & filter change");
    const when = await freeSlot(request, service.durationMinutes ?? 60);
    const before = await listAppointments(request);
    const bookingPosts: string[] = [];
    page.on("request", (outgoing) => {
      if (
        outgoing.method() === "POST" &&
        outgoing.url().includes("/api/appointments")
      ) {
        bookingPosts.push(outgoing.url());
      }
    });

    const { availability } = await requestAppointment(page, {
      dealership: dealership.name,
      vehicle: /Toyota Corolla/,
      service: service.name,
      when,
    });

    expect(availability.available).toBe(true);
    expect(availability.technician).toEqual(
      expect.objectContaining({ name: "Alex Tran" }),
    );
    expect(availability.serviceBay).toEqual(
      expect.objectContaining({ name: "Bay 1" }),
    );
    expect(availability.durationMinutes).toBe(60);
    expect(
      new Date(availability.endAt).getTime() -
        new Date(availability.startAt).getTime(),
    ).toBe(60 * 60_000);
    expect(bookingPosts).toEqual([]);
    expect(await listAppointments(request)).toHaveLength(before.length);

    await expect(page.getByRole("status")).toContainText(
      "A bay and technician are free",
    );
    await expect(page.getByRole("status")).toContainText(
      "Alex Tran · Bay 1 · 1 hour",
    );
    await expect(
      page.getByRole("heading", { name: "Confirm the appointment" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm appointment" }),
    ).toBeEnabled();
  });

  test("rejects a visit when the bay or technician is busy during any part of the service", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const dealership = byName(catalog.dealerships, "Central Auto Service");
    const vehicle = vehicleNamed(catalog, "Toyota", "Corolla");
    const oil = byName(catalog.services, "Oil & filter change");
    const major = byName(catalog.services, "Major service");
    const when = await freeSlot(request, 180);
    const blockedAt = addMinutes(when, 30);

    const first = await bookApi(request, {
      dealershipId: dealership.id,
      vehicleId: vehicle.id,
      serviceTypeId: oil.id,
      startAt: withOffset(blockedAt),
    });
    const second = await bookApi(request, {
      dealershipId: dealership.id,
      vehicleId: vehicle.id,
      serviceTypeId: oil.id,
      startAt: withOffset(blockedAt),
    });
    expect(first.serviceBayId).not.toBe(second.serviceBayId);
    expect(first.technicianId).not.toBe(second.technicianId);

    const before = await listAppointments(request);
    const overlapping = await requestAppointment(page, {
      dealership: dealership.name,
      vehicle: /Toyota Corolla/,
      service: major.name,
      when,
    });

    expect(overlapping.request).toMatchObject({
      dealershipId: dealership.id,
      serviceTypeId: major.id,
    });
    expectSameInstant(overlapping.request.startAt, when);
    expect(overlapping.availability).toMatchObject({
      available: false,
      durationMinutes: 120,
      technician: null,
      serviceBay: null,
    });
    expect(
      new Date(overlapping.availability.endAt).getTime() -
        new Date(overlapping.availability.startAt).getTime(),
    ).toBe(120 * 60_000);
    expect(await listAppointments(request)).toHaveLength(before.length);

    await expect(
      page.getByRole("heading", { name: "This time is unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "No bay and technician are free",
    );
    await expect(page.getByText("Nothing has been booked.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm appointment" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Choose another time" }).click();
    await expect(
      page.getByRole("heading", { name: "What service, and when?" }),
    ).toBeVisible();
    const adjacentAt = addMinutes(blockedAt, oil.durationMinutes ?? 60);
    await chooseService(page, oil.name, adjacentAt);
    const adjacent = await checkAvailability(page);

    expectSameInstant(adjacent.request.startAt, adjacentAt);
    expect(adjacent.availability.available).toBe(true);
    expect(adjacent.availability.technician?.name).toBe("Alex Tran");
    expect(adjacent.availability.serviceBay?.name).toBe("Bay 1");
    await expect(
      page.getByRole("button", { name: "Confirm appointment" }),
    ).toBeVisible();
  });

  test("checks only the dealership selected for the visit", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const central = byName(catalog.dealerships, "Central Auto Service");
    const riverside = byName(catalog.dealerships, "Riverside Motors");
    const vehicle = vehicleNamed(catalog, "Honda", "Civic");
    const oil = byName(catalog.services, "Oil & filter change");
    const when = await freeSlot(request, oil.durationMinutes ?? 60);
    const booking = {
      vehicleId: vehicle.id,
      serviceTypeId: oil.id,
      startAt: withOffset(when),
    };
    await bookApi(request, { ...booking, dealershipId: central.id });
    await bookApi(request, { ...booking, dealershipId: central.id });

    const otherWorkshop = await requestAppointment(page, {
      dealership: riverside.name,
      vehicle: /Honda Civic/,
      service: oil.name,
      when,
    });
    expect(otherWorkshop.request.dealershipId).toBe(riverside.id);
    expect(otherWorkshop.availability.available).toBe(true);
    expect(otherWorkshop.availability.technician).toBeTruthy();
    expect(otherWorkshop.availability.serviceBay).toBeTruthy();

    await openBooking(page);
    await chooseWorkshop(page, central.name, /Honda Civic/);
    await chooseService(page, oil.name, when);
    const fullWorkshop = await checkAvailability(page);
    expect(fullWorkshop.request.dealershipId).toBe(central.id);
    expect(fullWorkshop.availability.available).toBe(false);
    await expect(
      page.getByRole("button", { name: "Confirm appointment" }),
    ).toHaveCount(0);
  });
});
