// Shared 5s cadence for the dashboard's status polls — kept in one place
// so the three polling panels (Automation, Recent Activity, Pending
// Approvals) can't drift apart, and slowing it down for a slow server is
// a one-line change here instead of a find-and-replace across three files.
export const POLL_MS = 5000;
