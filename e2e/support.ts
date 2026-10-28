import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import type {
  Appointment,
  AppointmentPage,
  Availability,
  BookingRequest,
  Catalog,
  CatalogItem,
} from "../contracts/types";
import {
  addMinutes,
  formatDuration,
  localValue,
  withOffset,
} from "../apps/web/src/time";

export type { Appointment, Availability, BookingRequest, Catalog, CatalogItem };
export const localDateTimeValue = localValue;

export function expectSameInstant(actual: string, localValue: string) {
  expect(new Date(actual).toISOString()).toBe(
    new Date(localValue).toISOString(),
  );
}

export { addMinutes, formatDuration, withOffset };

async function readJson<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${response.status()} ${response.url()} ${await response.text()}`,
    );
  }
  return response.json() as Promise<T>;
}

const DEMO_PASSWORD = "scheduler-demo";

export const demoAccounts = {
  coordinator: {
    username: "coordinator",
    button: "Sign in as coordinator",
  },
  central: {
    username: "central.advisor",
    button: "Sign in as Central advisor",
  },
  riverside: {
    username: "riverside.advisor",
    button: "Sign in as Riverside advisor",
  },
} as const;

export type DemoAccount = keyof typeof demoAccounts;

const tokens = new Map<string, Promise<string>>();

export async function sessionToken(
  request: APIRequestContext,
  account: DemoAccount = "coordinator",
) {
  const username = demoAccounts[account].username;
  const existing = tokens.get(username);
  if (existing) return existing;
  const pending = readJson<{ token: string }>(
    await request.post("/api/session", {
      data: { username, password: DEMO_PASSWORD },
    }),
  ).then((body) => body.token);
  tokens.set(username, pending);
  return pending;
}

function authorized(token: string) {
  return { authorization: `Bearer ${token}` };
}

export async function loadCatalog(
  request: APIRequestContext,
  account: DemoAccount = "coordinator",
) {
  const token = await sessionToken(request, account);
  return readJson<Catalog>(
    await request.get("/api/catalog", { headers: authorized(token) }),
  );
}

export async function listAppointments(
  request: APIRequestContext,
  account: DemoAccount = "coordinator",
) {
  const token = await sessionToken(request, account);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 90);
  const items: Appointment[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({
      from: withOffset(localDateTimeValue(from)),
      to: withOffset(localDateTimeValue(to)),
      limit: "50",
    });
    if (cursor) params.set("cursor", cursor);
    const page = await readJson<AppointmentPage>(
      await request.get(`/api/appointments?${params}`, {
        headers: authorized(token),
      }),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
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
  const token = await sessionToken(request);
  return readJson<Appointment>(
    await request.post("/api/appointments", {
      data: booking,
      headers: {
        ...authorized(token),
        "idempotency-key": `e2e-${crypto.randomUUID()}`,
      },
    }),
  );
}

export async function signInAs(page: Page, account: DemoAccount = "coordinator") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const signIn = page.getByRole("button", {
    name: demoAccounts[account].button,
  });
  if (await signIn.isVisible().catch(() => false)) {
    await signIn.click();
  }
  await expect(
    page.getByRole("heading", { name: "Where should we book?" }),
  ).toBeVisible();
}

export async function openBooking(page: Page) {
  await signInAs(page, "coordinator");
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
