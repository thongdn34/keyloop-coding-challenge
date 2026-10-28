import { expect, test } from "@playwright/test";
import {
  byName,
  formatDuration,
  freeSlot,
  listAppointments,
  expectSameInstant,
  loadCatalog,
  requestAppointment,
  vehicleNamed,
} from "./support";

test.describe("resource constrained booking", () => {
  test("requests one dealership, vehicle, service, and desired time", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const dealership = byName(catalog.dealerships, "Riverside Motors");
    const vehicle = vehicleNamed(catalog, "Honda", "Civic");
    const service = byName(catalog.services, "Brake inspection");
    const customer = catalog.customers.find(
      (item) => item.id === vehicle.customerId,
    );
    const when = await freeSlot(request, service.durationMinutes ?? 90);
    const before = await listAppointments(request);

    const { request: body, availability } = await requestAppointment(page, {
      dealership: dealership.name,
      vehicle: /Honda Civic/,
      service: service.name,
      when,
    });

    expect(body).toMatchObject({
      dealershipId: dealership.id,
      vehicleId: vehicle.id,
      serviceTypeId: service.id,
    });
    expectSameInstant(body.startAt, when);
    expect(availability.durationMinutes).toBe(service.durationMinutes);
    expect(
      new Date(availability.endAt).getTime() -
        new Date(availability.startAt).getTime(),
    ).toBe((service.durationMinutes ?? 0) * 60_000);

    const review = page.locator(".review");
    await expect(
      page.getByRole("heading", { name: "Confirm the appointment" }),
    ).toBeVisible();
    await expect(review).toContainText(
      `${dealership.name}, ${dealership.city}`,
    );
    await expect(review).toContainText(
      `${vehicle.make} ${vehicle.model} · ${vehicle.registration}`,
    );
    await expect(review).toContainText(customer?.name ?? "");
    await expect(review).toContainText(
      `${service.name} · ${formatDuration(service.durationMinutes ?? 0)}`,
    );
    await expect(review.locator("time").nth(0)).toHaveAttribute(
      "datetime",
      availability.startAt,
    );
    await expect(review.locator("time").nth(1)).toHaveAttribute(
      "datetime",
      availability.endAt,
    );

    expect(await listAppointments(request)).toHaveLength(before.length);
    await expect(page.locator(".booking.fresh")).toHaveCount(0);
  });

  test("sends the service chosen for that vehicle and workshop", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const dealership = byName(catalog.dealerships, "Central Auto Service");
    const vehicle = vehicleNamed(catalog, "Toyota", "Corolla");
    const service = byName(catalog.services, "Major service");
    const when = await freeSlot(request, service.durationMinutes ?? 120);

    const { request: body, availability } = await requestAppointment(page, {
      dealership: dealership.name,
      vehicle: /Toyota Corolla/,
      service: service.name,
      when,
    });

    expect(body).toMatchObject({
      dealershipId: dealership.id,
      vehicleId: vehicle.id,
      serviceTypeId: service.id,
    });
    expectSameInstant(body.startAt, when);
    expect(availability.durationMinutes).toBe(120);
    await expect(page.locator(".review")).toContainText(
      "Major service · 2 hours",
    );
    await expect(page.locator(".review")).toContainText("59A-12345");
    await expect(
      page.getByRole("button", { name: "Confirm appointment" }),
    ).toBeVisible();
  });
});
