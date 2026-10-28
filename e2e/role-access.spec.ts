import { expect, test } from "@playwright/test";
import {
  byName,
  demoAccounts,
  freeSlot,
  loadCatalog,
  requestAppointment,
  sessionToken,
  signInAs,
  vehicleNamed,
} from "./support";

test.describe("dealership roles", () => {
  test("an advisor can see and book only their own workshop", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const central = byName(catalog.dealerships, "Central Auto Service");
    const riverside = byName(catalog.dealerships, "Riverside Motors");
    const vehicle = vehicleNamed(catalog, "Honda", "Civic");
    const service = byName(catalog.services, "Oil & filter change");
    const token = await sessionToken(request, "central");
    const headers = { authorization: `Bearer ${token}` };

    const ownCatalog = await loadCatalog(request, "central");
    expect(ownCatalog.dealerships.map((item) => item.name)).toEqual([
      central.name,
    ]);
    expect(ownCatalog.customers.every((item) => !("email" in item))).toBe(true);

    const deniedBooking = await request.post("/api/appointments", {
      headers,
      data: {
        dealershipId: riverside.id,
        vehicleId: vehicle.id,
        serviceTypeId: service.id,
        startAt: "2099-06-01T09:00:00+07:00",
      },
    });
    expect(deniedBooking.status()).toBe(403);

    const deniedHistory = await request.get(
      `/api/appointments?dealershipId=${riverside.id}` +
        "&from=2099-06-01T00:00:00%2B07:00&to=2099-06-15T00:00:00%2B07:00",
      { headers },
    );
    expect(deniedHistory.status()).toBe(403);

    const ownHistory = await request.get(
      `/api/appointments?dealershipId=${central.id}` +
        "&from=2099-06-01T00:00:00%2B07:00&to=2099-06-15T00:00:00%2B07:00",
      { headers },
    );
    expect(ownHistory.ok()).toBe(true);

    await signInAs(page, "central");
    await expect(
      page.getByRole("radio", { name: new RegExp(central.name) }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: new RegExp(riverside.name) }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Sign out" }).click();
    await signInAs(page, "riverside");
    await expect(
      page.getByRole("radio", { name: new RegExp(riverside.name) }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: new RegExp(central.name) }),
    ).toHaveCount(0);
  });

  test("signing out clears the previous user's booking", async ({
    page,
    request,
  }) => {
    const catalog = await loadCatalog(request);
    const service = byName(catalog.services, "Oil & filter change");
    const when = await freeSlot(request, service.durationMinutes ?? 60);
    await requestAppointment(page, {
      dealership: "Central Auto Service",
      vehicle: /Toyota Corolla/,
      service: service.name,
      when,
    });
    await expect(
      page.getByRole("heading", { name: "Confirm the appointment" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page
      .getByRole("button", { name: demoAccounts.riverside.button })
      .click();
    await expect(
      page.getByRole("heading", { name: "Where should we book?" }),
    ).toBeVisible();
    await expect(page.getByText("A bay and technician are free")).toHaveCount(
      0,
    );
  });

  test("the coordinator receives both workshops", async ({ request }) => {
    const catalog = await loadCatalog(request, "coordinator");
    expect(catalog.dealerships.map((item) => item.name).sort()).toEqual([
      "Central Auto Service",
      "Riverside Motors",
    ]);
  });
});
