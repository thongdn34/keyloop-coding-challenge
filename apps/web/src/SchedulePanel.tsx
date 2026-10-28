import type { CatalogItem } from "../../../contracts/types.ts";
import { CalendarOff, CircleAlert } from "lucide-react";
import { visitState, type TimedVisit } from "./booking.ts";

const icon = { size: 20, strokeWidth: 2, "aria-hidden": true as const };

type AppointmentRecord = TimedVisit & {
  id: number;
  dealershipId: number;
  customerId: number;
  vehicleId: number;
  serviceTypeId: number;
  startAt: string;
};

export function SchedulePanel({
  loading,
  error,
  onRetry,
  appointments,
  schedule,
  visibleOpen,
  dealerships,
  locationFilter,
  onFilter,
  lookups,
  confirmedId,
  now,
  horizonDays,
  onShowLater,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  appointments: AppointmentRecord[];
  schedule: AppointmentRecord[];
  visibleOpen: number;
  dealerships: CatalogItem[];
  locationFilter: number | "all";
  onFilter: (value: number | "all") => void;
  lookups: {
    vehicles: Map<number, CatalogItem>;
    services: Map<number, CatalogItem>;
    dealerships: Map<number, CatalogItem>;
    customers: Map<number, CatalogItem>;
  };
  confirmedId: number | null;
  now: number;
  horizonDays: number;
  onShowLater: () => void;
}) {
  return (
    <aside className="schedule" aria-labelledby="schedule-heading">
      <div className="panel-intro">
        <h2 id="schedule-heading">Workshop diary</h2>
        <p>
          {loading
            ? "Loading confirmed visits"
            : visibleOpen === 1
              ? "1 still open"
              : visibleOpen
                ? `${visibleOpen} still open`
                : "No open visits"}
        </p>
      </div>
      <div className="filters" role="group" aria-label="Filter by dealership">
        <button
          type="button"
          className="filter"
          aria-pressed={locationFilter === "all"}
          onClick={() => onFilter("all")}
        >
          All locations
        </button>
        {dealerships.map((item) => (
          <button
            key={item.id}
            type="button"
            className="filter"
            aria-pressed={locationFilter === item.id}
            onClick={() => onFilter(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="skeleton" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading appointments</span>
          <span className="skeleton-line" />
          <span className="skeleton-line short" />
          <span className="skeleton-line" />
        </div>
      ) : error ? (
        <div className="banner bad" role="alert">
          <CircleAlert {...icon} />
          <div>
            <strong>Appointments could not be loaded.</strong>
            <p>{error}</p>
            <button type="button" className="btn-secondary" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      ) : schedule.length === 0 ? (
        <div className="empty">
          <CalendarOff size={28} strokeWidth={2} aria-hidden="true" />
          <strong>
            {appointments.length
              ? "No appointments for this location"
              : "No appointments yet"}
          </strong>
          <p>
            {appointments.length
              ? "Try another workshop, or book a visit at this one."
              : "Confirmed visits will show here after you book."}
          </p>
          <a className="btn-secondary" href="#booking">
            Book an appointment
          </a>
        </div>
      ) : (
        <ul className="bookings">
          {schedule.map((item) => {
            const when = formatWhen(item.startAt);
            const end = formatWhen(item.endAt);
            const bookedVehicle = lookups.vehicles.get(item.vehicleId);
            const bookedService = lookups.services.get(item.serviceTypeId);
            const bookedDealer = lookups.dealerships.get(item.dealershipId);
            const bookedCustomer = lookups.customers.get(item.customerId);
            const state =
              item.id === confirmedId ? "Just booked" : visitState(item, now);
            return (
              <li
                className={
                  item.id === confirmedId ? "booking fresh" : "booking"
                }
                key={item.id}
              >
                <time className="when" dateTime={item.startAt}>
                  <span>{when.month}</span>
                  <strong>{when.day}</strong>
                </time>
                <div className="booking-copy">
                  <strong>
                    {bookedVehicle
                      ? `${bookedVehicle.make} ${bookedVehicle.model}`
                      : `Vehicle ${item.vehicleId}`}
                  </strong>
                  <p>
                    {when.time}–{end.time}
                  </p>
                  {bookedService ? <p>{bookedService.name}</p> : null}
                  <p>
                    {[
                      bookedDealer?.name,
                      bookedCustomer?.name,
                      bookedVehicle?.registration,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span
                  className={`chip chip-${state.replace(" ", "-").toLowerCase()}`}
                >
                  {state}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {horizonDays < 93 ? (
        <div className="actions">
          <button type="button" className="btn-secondary" onClick={onShowLater}>
            Show later visits
          </button>
        </div>
      ) : null}
      <p className="note">
        <strong>One assignment at a time.</strong> Confirming a visit keeps that
        technician and bay for the whole service, so two bookings cannot claim
        the same resource. This diary shows the next {horizonDays} days.
      </p>
    </aside>
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
  };
}
