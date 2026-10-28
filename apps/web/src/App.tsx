import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Car,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Loader2,
  MapPin,
  UserRound,
  Wrench,
} from "lucide-react";
import type {
  Appointment,
  AppointmentPage,
  Availability,
  Catalog,
  CatalogItem,
} from "../../../contracts/types.ts";
import {
  readSession,
  request,
  SessionExpired,
  setSession,
  signIn,
} from "./api.ts";
import { openCount, sortSchedule } from "./booking.ts";
import { Choice } from "./Choice.tsx";
import { LoginScreen } from "./LoginScreen.tsx";
import { SchedulePanel } from "./SchedulePanel.tsx";
import {
  addLocalDays,
  defaultSlot,
  formatDuration,
  localValue,
  startOfLocalDay,
  timeIssue,
  withOffset,
} from "./time.ts";

type Issue = { href: string; message: string };

const icon = { size: 20, strokeWidth: 2, "aria-hidden": true as const };
const DEMO_PASSWORD = "scheduler-demo";

async function loadAppointments(from: string, to: string) {
  const items: Appointment[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ from, to, limit: "50" });
    if (cursor) params.set("cursor", cursor);
    const body = await request<AppointmentPage>(`appointments?${params}`);
    items.push(...body.items);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return items;
}

function zoneName(value: string) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "local time";
  return (
    new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "local time"
  );
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  return {
    month: date.toLocaleDateString(undefined, { month: "short" }),
    day: date.toLocaleDateString(undefined, { day: "numeric" }),
    time: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
    long: date.toLocaleString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export default function App() {
  const queryClient = useQueryClient();
  const errorTitleId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const skipStepFocus = useRef(true);

  const [session, setSessionState] = useState(readSession);
  const [signInError, setSignInError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const windowStart = useMemo(() => startOfLocalDay(), []);
  const [horizonDays, setHorizonDays] = useState(31);
  const windowEnd = useMemo(
    () => addLocalDays(windowStart, horizonDays),
    [windowStart, horizonDays],
  );

  const catalogQuery = useQuery({
    queryKey: ["catalog", session?.token],
    enabled: Boolean(session),
    queryFn: () => request<Catalog>("catalog"),
  });
  const appointmentsQuery = useQuery({
    queryKey: ["appointments", session?.token, windowStart, windowEnd],
    enabled: Boolean(session),
    queryFn: () => loadAppointments(windowStart, windowEnd),
  });

  const data = catalogQuery.data;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dealershipId, setDealershipId] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [serviceTypeId, setServiceTypeId] = useState<number | null>(null);
  const [time, setTime] = useState(defaultSlot);
  const [result, setResult] = useState<Availability | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [confirmedId, setConfirmedId] = useState<number | null>(null);
  const [locationFilter, setLocationFilter] = useState<number | "all">("all");

  const selectedDealer = data?.dealerships.some(
    (item) => item.id === dealershipId,
  )
    ? dealershipId
    : (data?.dealerships[0]?.id ?? 0);
  const selectedVehicle = data?.vehicles.some((item) => item.id === vehicleId)
    ? vehicleId
    : (data?.vehicles[0]?.id ?? 0);
  const selectedService = data?.services.some(
    (item) => item.id === serviceTypeId,
  )
    ? serviceTypeId
    : (data?.services[0]?.id ?? 0);

  const lookups = useMemo(() => {
    const index = (items: CatalogItem[] = []) =>
      new Map(items.map((item) => [item.id, item]));
    return {
      dealerships: index(data?.dealerships),
      vehicles: index(data?.vehicles),
      services: index(data?.services),
      customers: index(data?.customers),
    };
  }, [data]);

  const dealer = lookups.dealerships.get(selectedDealer ?? 0);
  const vehicle = lookups.vehicles.get(selectedVehicle ?? 0);
  const service = lookups.services.get(selectedService ?? 0);
  const customer = vehicle
    ? lookups.customers.get(vehicle.customerId ?? 0)
    : undefined;

  const payload = {
    dealershipId: selectedDealer ?? 0,
    vehicleId: selectedVehicle ?? 0,
    serviceTypeId: selectedService ?? 0,
    startAt: withOffset(time),
  };

  const signInMutation = useMutation({
    mutationFn: (username: string) => signIn(username, DEMO_PASSWORD),
    onSuccess: (next) => {
      setSessionState(next);
      setSignInError(null);
    },
    onError: (error) => {
      setSignInError(
        error instanceof Error ? error.message : "Sign-in failed.",
      );
    },
  });
  const check = useMutation({
    mutationFn: () => request<Availability>("availability", { body: payload }),
  });
  const book = useMutation({
    mutationFn: () =>
      request<Appointment>("appointments", {
        body: payload,
        idempotencyKey: idempotencyKey.current ?? undefined,
      }),
    onSuccess: (saved) => {
      setConfirmedId(saved.id);
      setIssues([]);
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });

  useEffect(() => {
    if (skipStepFocus.current) {
      skipStepFocus.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (issues.length === 0) return;
    summaryRef.current?.focus();
  }, [issues]);

  useEffect(() => {
    if (confirmedId == null) return;
    successRef.current?.focus();
  }, [confirmedId]);

  function clearOutcome() {
    setResult(null);
    setConfirmedId(null);
    setIssues([]);
    idempotencyKey.current = null;
    check.reset();
    book.reset();
  }

  function report(next: Issue[], nextStep?: 1 | 2 | 3) {
    if (nextStep) setStep(nextStep);
    setIssues(next);
  }

  async function checkAvailability() {
    const message = timeIssue(time);
    if (message) {
      report([{ href: "#appointment-time", message }], 2);
      return;
    }
    if (!selectedDealer || !selectedVehicle || !selectedService) {
      report(
        [
          {
            href: "#dealership-field",
            message: "Choose a dealership, vehicle, and service.",
          },
        ],
        1,
      );
      return;
    }
    try {
      const availability = await check.mutateAsync();
      idempotencyKey.current = crypto.randomUUID();
      setResult(availability);
      setIssues([]);
      setConfirmedId(null);
      setStep(3);
    } catch (error) {
      report(
        [
          {
            href: "#appointment-time",
            message:
              error instanceof Error
                ? error.message
                : "Availability could not be checked.",
          },
        ],
        2,
      );
    }
  }

  async function confirmBooking() {
    if (!result?.available) return;
    try {
      await book.mutateAsync();
    } catch (error) {
      setResult(null);
      report(
        [
          {
            href: "#appointment-time",
            message:
              error instanceof Error
                ? error.message
                : "The appointment could not be saved.",
          },
        ],
        2,
      );
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (step === 1) {
      setIssues([]);
      setStep(2);
      return;
    }
    if (step === 2) {
      void checkAvailability();
      return;
    }
    void confirmBooking();
  }

  function endSession() {
    setSession(null);
    setSessionState(null);
    setStep(1);
    setDealershipId(null);
    setVehicleId(null);
    setServiceTypeId(null);
    setTime(defaultSlot());
    setLocationFilter("all");
    setHorizonDays(31);
    clearOutcome();
    queryClient.removeQueries();
  }

  function bookAnother() {
    setConfirmedId(null);
    setResult(null);
    setIssues([]);
    check.reset();
    book.reset();
    setTime(defaultSlot());
    setStep(1);
  }

  const now = Date.now();
  const appointments = appointmentsQuery.data ?? [];
  const upcomingCount = openCount(appointments, now);
  const schedule = sortSchedule(
    appointments.filter((item) =>
      locationFilter === "all" ? true : item.dealershipId === locationFilter,
    ),
    now,
  );
  const visibleOpen = openCount(schedule, now);

  useEffect(() => {
    if (
      catalogQuery.error instanceof SessionExpired ||
      appointmentsQuery.error instanceof SessionExpired
    ) {
      endSession();
    }
  }, [catalogQuery.error, appointmentsQuery.error]);

  const timeProblem = issues.find(
    (issue) => issue.href === "#appointment-time",
  );
  const busy = check.isPending || book.isPending;
  const catalogReady = Boolean(
    data &&
      data.dealerships.length &&
      data.vehicles.length &&
      data.services.length,
  );

  if (!session) {
    return (
      <>
        <header className="site-header">
          <div className="shell header-inner">
            <div className="brand">
              <span className="mark">
                <CalendarDays size={24} strokeWidth={2} aria-hidden="true" />
              </span>
              <span>
                <span className="brand-name">Appointment Scheduler</span>
                <span className="brand-sub">Unified service booking</span>
              </span>
            </div>
          </div>
        </header>
        <LoginScreen
          pending={signInMutation.isPending}
          error={signInError}
          onSignIn={(username) => signInMutation.mutate(username)}
        />
      </>
    );
  }

  return (
    <>
      <a className="skip" href="#booking">
        Skip to booking
      </a>
      <header className="site-header">
        <div className="shell header-inner">
          <div className="brand">
            <span className="mark">
              <CalendarDays size={24} strokeWidth={2} aria-hidden="true" />
            </span>
            <span>
              <span className="brand-name">Appointment Scheduler</span>
              <span className="brand-sub">Unified service booking</span>
            </span>
          </div>
          <p className={catalogQuery.isError ? "status down" : "status"}>
            <span className="status-dot" aria-hidden="true" />
            {catalogQuery.isError ? "Catalog unavailable" : session.username}
          </p>
          <button type="button" className="btn-secondary" onClick={endSession}>
            Sign out
          </button>
        </div>
      </header>
      <main className="shell page">
        <section className="intro">
          <p className="eyebrow">Replaces the workshop diary</p>
          <h1>Schedule a service appointment</h1>
          <p>
            Choose the vehicle and the work, check that a bay and a qualified
            technician are free for the whole visit, then confirm the slot.
          </p>
        </section>
        <ul className="stats">
          <li className="stat">
            <span>Upcoming</span>
            <strong>{appointmentsQuery.isLoading ? "…" : upcomingCount}</strong>
          </li>
          <li className="stat">
            <span>Dealerships</span>
            <strong>
              {catalogQuery.isLoading ? "…" : (data?.dealerships.length ?? 0)}
            </strong>
          </li>
          <li className="stat">
            <span>Services</span>
            <strong>
              {catalogQuery.isLoading ? "…" : (data?.services.length ?? 0)}
            </strong>
          </li>
        </ul>
        <div className="layout">
          <section className="panel" aria-labelledby="booking-heading">
            <div className="panel-intro">
              <h2 id="booking-heading">New appointment</h2>
              <p>Three steps. The slot is reserved only when you confirm.</p>
            </div>
            <ol className="steps" aria-label="Booking progress">
              {(
                [
                  [1, "Vehicle"],
                  [2, "Service"],
                  [3, "Confirm"],
                ] as const
              ).map(([number, label]) => {
                const done =
                  number < step || (number === 3 && confirmedId != null);
                const locked = number === 3 && !result && confirmedId == null;
                return (
                  <li key={number}>
                    <button
                      type="button"
                      className="step-btn"
                      aria-current={step === number ? "step" : undefined}
                      disabled={locked || busy}
                      onClick={() => {
                        setIssues([]);
                        setStep(number);
                      }}
                    >
                      <span className="step-index" aria-hidden="true">
                        {done && step !== number ? (
                          <Check size={14} strokeWidth={2.5} />
                        ) : (
                          number
                        )}
                      </span>
                      {label}
                      {done && step !== number ? (
                        <span className="sr-only"> completed</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>

            {catalogQuery.isLoading ? (
              <div className="skeleton" aria-busy="true" aria-live="polite">
                <span className="sr-only">
                  Loading dealerships and services
                </span>
                <span className="skeleton-line" />
                <span className="skeleton-line" />
                <span className="skeleton-line short" />
              </div>
            ) : catalogQuery.isError ? (
              <div className="banner bad" role="alert">
                <CircleAlert {...icon} />
                <div>
                  <strong>The service catalog could not be loaded.</strong>
                  <p>{catalogQuery.error.message}</p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void catalogQuery.refetch()}
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : !catalogReady ? (
              <div className="banner bad" role="alert">
                <CircleAlert {...icon} />
                <div>
                  <strong>Nothing is available to book yet.</strong>
                  <p>
                    Add a dealership, a vehicle, and a service before scheduling
                    a visit.
                  </p>
                </div>
              </div>
            ) : (
              <form
                id="booking"
                className="booking-form"
                onSubmit={onSubmit}
                noValidate
                aria-busy={busy || undefined}
              >
                {issues.length > 0 ? (
                  <div
                    ref={summaryRef}
                    id="form-errors"
                    className="error-summary"
                    role="alert"
                    tabIndex={-1}
                    aria-labelledby={errorTitleId}
                  >
                    <h2 id={errorTitleId}>There is a problem</h2>
                    <ul>
                      {issues.map((issue) => (
                        <li key={issue.href + issue.message}>
                          <a href={issue.href}>{issue.message}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="step-panel">
                    <h3 ref={headingRef} tabIndex={-1}>
                      Where should we book?
                    </h3>
                    <p className="step-copy">
                      Choose the workshop and the vehicle for this visit.
                    </p>
                    <fieldset className="field" id="dealership-field">
                      <legend>Dealership</legend>
                      <div className="choices split">
                        {data!.dealerships.map((item) => (
                          <Choice
                            key={item.id}
                            id={`dealership-${item.id}`}
                            name="dealership"
                            checked={selectedDealer === item.id}
                            disabled={busy}
                            title={item.name}
                            detail={item.city ?? "Workshop"}
                            glyph={<Building2 {...icon} />}
                            onChange={() => {
                              setDealershipId(item.id);
                              clearOutcome();
                            }}
                          />
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="field">
                      <legend>Vehicle</legend>
                      <div className="choices split">
                        {data!.vehicles.map((item) => {
                          const owner = lookups.customers.get(
                            item.customerId ?? 0,
                          );
                          return (
                            <Choice
                              key={item.id}
                              id={`vehicle-${item.id}`}
                              name="vehicle"
                              checked={selectedVehicle === item.id}
                              disabled={busy}
                              title={`${item.make} ${item.model}`}
                              detail={[item.registration, owner?.name]
                                .filter(Boolean)
                                .join(" · ")}
                              glyph={<Car {...icon} />}
                              onChange={() => {
                                setVehicleId(item.id);
                                clearOutcome();
                              }}
                            />
                          );
                        })}
                      </div>
                    </fieldset>
                    <div className="actions">
                      <button className="btn-primary" type="submit">
                        Continue
                        <ArrowRight {...icon} />
                      </button>
                    </div>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="step-panel">
                    <h3 ref={headingRef} tabIndex={-1}>
                      What service, and when?
                    </h3>
                    <p className="step-copy">
                      The check covers the full service length. It does not
                      reserve the slot.
                    </p>
                    <fieldset className="field">
                      <legend>Service</legend>
                      <div className="choices">
                        {data!.services.map((item) => (
                          <Choice
                            key={item.id}
                            id={`service-${item.id}`}
                            name="service"
                            checked={selectedService === item.id}
                            disabled={busy}
                            title={item.name}
                            detail={formatDuration(item.durationMinutes ?? 0)}
                            glyph={<Wrench {...icon} />}
                            onChange={() => {
                              setServiceTypeId(item.id);
                              clearOutcome();
                            }}
                          />
                        ))}
                      </div>
                    </fieldset>
                    <div className="field">
                      <label htmlFor="appointment-time">
                        Appointment date and time
                      </label>
                      <input
                        id="appointment-time"
                        type="datetime-local"
                        value={time}
                        min={localValue(new Date())}
                        aria-invalid={timeProblem ? true : undefined}
                        aria-describedby={
                          timeProblem ? "time-hint time-error" : "time-hint"
                        }
                        disabled={busy}
                        onChange={(event) => {
                          setTime(event.target.value);
                          clearOutcome();
                        }}
                        required
                      />
                      <p id="time-hint" className="hint">
                        <Clock {...icon} />
                        Times use {zoneName(time)}. A{" "}
                        {service
                          ? formatDuration(service.durationMinutes ?? 0)
                          : "full"}{" "}
                        visit is checked from this start.
                      </p>
                      {timeProblem ? (
                        <p id="time-error" className="field-error">
                          {timeProblem.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => {
                          setIssues([]);
                          setStep(1);
                        }}
                      >
                        <ArrowLeft {...icon} />
                        Back
                      </button>
                      <button
                        className="btn-primary"
                        type="submit"
                        disabled={check.isPending}
                        aria-busy={check.isPending}
                      >
                        {check.isPending ? (
                          <Loader2 className="spin" {...icon} />
                        ) : (
                          <ArrowRight {...icon} />
                        )}
                        {check.isPending
                          ? "Checking availability"
                          : "Check availability"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {step === 3 && result ? (
                  <div className="step-panel">
                    <h3 ref={headingRef} tabIndex={-1}>
                      {confirmedId
                        ? "Appointment confirmed"
                        : result.available
                          ? "Confirm the appointment"
                          : "This time is unavailable"}
                    </h3>
                    <p className="step-copy">
                      {confirmedId
                        ? "The bay and technician are reserved for this visit."
                        : result.available
                          ? "Confirming reserves the bay and technician for the full service."
                          : "Choose another time or workshop. Nothing has been booked."}
                    </p>
                    {confirmedId != null ? (
                      <div
                        ref={successRef}
                        className="banner ok"
                        role="status"
                        tabIndex={-1}
                      >
                        <CircleCheck {...icon} />
                        <div>
                          <strong>Booking {confirmedId} is saved.</strong>
                          <p>
                            It is listed with the other confirmed appointments.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={
                          result.available ? "banner ok" : "banner bad"
                        }
                        role="status"
                      >
                        {result.available ? (
                          <CircleCheck {...icon} />
                        ) : (
                          <CircleAlert {...icon} />
                        )}
                        <div>
                          <strong>
                            {result.available
                              ? "A bay and technician are free"
                              : "No bay and technician are free"}
                          </strong>
                          <p>
                            {result.available
                              ? `${result.technician?.name ?? "Technician"} · ${result.serviceBay?.name ?? "Service bay"} · ${formatDuration(result.durationMinutes)}`
                              : "The full visit overlaps an existing assignment."}
                          </p>
                        </div>
                      </div>
                    )}
                    <dl className="review">
                      <div>
                        <dt>Dealership</dt>
                        <dd>
                          <MapPin {...icon} />
                          {dealer
                            ? `${dealer.name}, ${dealer.city}`
                            : "Dealership"}
                        </dd>
                      </div>
                      <div>
                        <dt>Vehicle</dt>
                        <dd>
                          <Car {...icon} />
                          {vehicle
                            ? `${vehicle.make} ${vehicle.model} · ${vehicle.registration}`
                            : "Vehicle"}
                        </dd>
                      </div>
                      <div>
                        <dt>Customer</dt>
                        <dd>
                          <UserRound {...icon} />
                          {customer ? customer.name : "Customer"}
                        </dd>
                      </div>
                      <div>
                        <dt>Service</dt>
                        <dd>
                          <Wrench {...icon} />
                          {service
                            ? `${service.name} · ${formatDuration(service.durationMinutes ?? result.durationMinutes)}`
                            : formatDuration(result.durationMinutes)}
                        </dd>
                      </div>
                      <div>
                        <dt>Starts</dt>
                        <dd>
                          <Clock {...icon} />
                          <time dateTime={result.startAt}>
                            {formatWhen(result.startAt).long}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>Ends</dt>
                        <dd>
                          <time dateTime={result.endAt}>
                            {formatWhen(result.endAt).long}
                          </time>
                        </dd>
                      </div>
                    </dl>
                    <div className="actions">
                      {confirmedId == null ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            setIssues([]);
                            setStep(2);
                          }}
                        >
                          <ArrowLeft {...icon} />
                          {result.available
                            ? "Edit service"
                            : "Choose another time"}
                        </button>
                      ) : null}
                      {confirmedId == null && result.available ? (
                        <button
                          className="btn-primary"
                          type="submit"
                          disabled={book.isPending}
                          aria-busy={book.isPending}
                        >
                          {book.isPending ? (
                            <Loader2 className="spin" {...icon} />
                          ) : (
                            <CircleCheck {...icon} />
                          )}
                          {book.isPending
                            ? "Confirming appointment"
                            : "Confirm appointment"}
                        </button>
                      ) : null}
                      {confirmedId != null ? (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={bookAnother}
                        >
                          Book another appointment
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </form>
            )}
          </section>

          <SchedulePanel
            loading={appointmentsQuery.isLoading}
            error={
              appointmentsQuery.isError ? appointmentsQuery.error.message : null
            }
            onRetry={() => void appointmentsQuery.refetch()}
            appointments={appointments}
            schedule={schedule}
            visibleOpen={visibleOpen}
            dealerships={data?.dealerships ?? []}
            locationFilter={locationFilter}
            onFilter={setLocationFilter}
            lookups={lookups}
            confirmedId={confirmedId}
            now={now}
            horizonDays={horizonDays}
            onShowLater={() =>
              setHorizonDays((days) => Math.min(days + 31, 93))
            }
          />
        </div>
      </main>
      <footer className="site-footer">
        <div className="shell footer-inner">
          <span>Unified Service Scheduler</span>
          <span>React · NestJS · PostgreSQL</span>
        </div>
      </footer>
    </>
  );
}
