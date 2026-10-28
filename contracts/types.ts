export type CatalogItem = {
  id: number;
  name: string;
  city?: string;
  durationMinutes?: number;
  make?: string;
  model?: string;
  registration?: string;
  customerId?: number;
};

export type Catalog = {
  dealerships: CatalogItem[];
  vehicles: CatalogItem[];
  services: CatalogItem[];
  customers: CatalogItem[];
};

export type Resource = { id: number; name: string } | null;

export type Availability = {
  available: boolean;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  technician: Resource;
  serviceBay: Resource;
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
  status: "confirmed" | "cancelled";
};

export type AppointmentPage = {
  items: Appointment[];
  nextCursor: string | null;
};

export type BookingRequest = {
  dealershipId: number;
  vehicleId: number;
  serviceTypeId: number;
  startAt: string;
};

export type Session = {
  token: string;
  username: string;
  role: "advisor" | "coordinator";
  dealershipIds: number[];
  expiresAt: string;
};
