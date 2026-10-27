import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

export type CatalogItem = {
  id: number;
  name: string;
  city?: string;
  durationMinutes?: number;
  make?: string;
  model?: string;
  registration?: string;
  customerId?: number;
  email?: string;
};

export type Catalog = {
  dealerships: CatalogItem[];
  vehicles: CatalogItem[];
  services: CatalogItem[];
  customers: CatalogItem[];
};

export type Availability = {
  available: boolean;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  technician: { id: number; name: string } | null;
  serviceBay: { id: number; name: string } | null;
};

export type Appointment = {
  id: number;
  dealershipId: number;
  customerId: number;
  vehicleId: number;
  serviceTypeId: number;
  technicianId: number;
  serviceBayId: number;
  startAt: string;
  endAt: string;
  status: string;
};

export type BookingRequest = {
  dealershipId: number;
  vehicleId: number;
  serviceTypeId: number;
  startAt: string;
};

export function localDateTimeValue(date: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Same offset conversion the booking form uses. Node and the browser must share a timezone. */
export function withOffset(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function expectSameInstant(actual: string, localValue: string) {
  expect(new Date(actual).toISOString()).toBe(
    new Date(localValue).toISOString(),
  );
}

export function addMinutes(value: string, minutes: number) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return localDateTimeValue(date);
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours} hr ${remainder} min`;
  if (hours) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${remainder} min`;
}

async function readJson<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${response.status()} ${response.url()} ${await response.text()}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function loadCatalog(request: APIRequestContext) {
  return readJson<Catalog>(await request.get("/api/catalog"));
}

export async function listAppointments(request: APIRequestContext) {
  return readJson<Appointment[]>(await request.get("/api/appointments"));
}

export function byName(items: CatalogItem[], name: string) {
  const item = items.find((entry) => entry.name === name);
  if (!item) throw new Error(`Missing catalog item: ${name}`);
  return item;
}

export function vehicleNamed(catalog: Catalog, make: string, model: string) {
  const item = catalog.vehicles.find(
    (entry) => entry.make === make && entry.model === model,
  );
  if (!item) throw new Error(`Missing vehicle: ${make} ${model}`);
  return item;
}

/** A future local slot whose whole span does not overlap an existing appointment. */
export async function freeSlot(
  request: APIRequestContext,
  spanMinutes: number,
) {
  const appointments = await listAppointments(request);
  const busy = appointments.map((item) => ({
    start: new Date(item.startAt).getTime(),
    end: new Date(item.endAt).getTime(),
  }));
  const span = spanMinutes * 60_000;
  const cursor = new Date();
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 2 * 24 * 60);

  for (let attempt = 0; attempt < 4000; attempt += 1) {
    const start = cursor.getTime();
    const end = start + span;
    const taken = busy.some((item) => item.start < end && item.end > start);
    if (!taken) return localDateTimeValue(new Date(start));
    cursor.setMinutes(cursor.getMinutes() + 30);
  }

  throw new Error(`No free ${spanMinutes}-minute window`);
}

export async function bookApi(
  request: APIRequestContext,
  booking: BookingRequest,
) {
  return readJson<Appointment>(
    await request.post("/api/appointments", { data: booking }),
  );
}

export async function openBooking(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Where should we book?" }),
  ).toBeVisible();
}

export async function chooseWorkshop(
  page: Page,
  dealership: string,
  vehicle: RegExp,
) {
  await page.getByRole("radio", { name: new RegExp(dealership) }).check();
  await page.getByRole("radio", { name: vehicle }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "What service, and when?" }),
  ).toBeVisible();
}

export async function chooseService(page: Page, service: string, when: string) {
  await page.getByRole("radio", { name: new RegExp(service) }).check();
  await page.locator("#appointment-time").fill(when);
  await expect(page.locator("#appointment-time")).toHaveValue(when);
}

export async function checkAvailability(page: Page) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/availability") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Check availability" }).click();
  const response = await responsePromise;
  return {
    request: response.request().postDataJSON() as BookingRequest,
    availability: await readJson<Availability>(response),
  };
}

export async function confirmAppointment(page: Page) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/appointments") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm appointment" }).click();
  const response = await responsePromise;
  return readJson<Appointment>(response);
}

export async function requestAppointment(
  page: Page,
  input: {
    dealership: string;
    vehicle: RegExp;
    service: string;
    when: string;
  },
) {
  await openBooking(page);
  await chooseWorkshop(page, input.dealership, input.vehicle);
  await chooseService(page, input.service, input.when);
  return checkAvailability(page);
}
