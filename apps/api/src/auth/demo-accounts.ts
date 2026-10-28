export const DEMO_PASSWORD = "scheduler-demo";

export const DEMO_ACCOUNTS = [
  {
    username: "coordinator",
    role: "coordinator" as const,
    dealershipName: null,
  },
  {
    username: "central.advisor",
    role: "advisor" as const,
    dealershipName: "Central Auto Service",
  },
  {
    username: "riverside.advisor",
    role: "advisor" as const,
    dealershipName: "Riverside Motors",
  },
];
