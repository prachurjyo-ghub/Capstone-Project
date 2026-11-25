// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { AdminShell } from "./admin-shell";
import { SnapshotDetails } from "./snapshot-details";
import { statusTone } from "./ui";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ onClick, ...props }: ComponentProps<"a">) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    />
  ),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));
vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    account: { fullName: "Test Admin", role: "ADMIN" },
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/use-resource", () => ({ useResource: () => ({ data: null }) }));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(cleanup);

describe("admin mobile navigation", () => {
  it("closes after choosing a destination and restores focus to the menu", async () => {
    render(
      <AdminShell>
        <p>Workspace</p>
      </AdminShell>,
    );
    const menu = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(menu);
    const dialog = await screen.findByRole("dialog", {
      name: "Admin navigation",
    });
    fireEvent.click(within(dialog).getByRole("link", { name: "Catalogue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menu));
  });

  it("keeps mobile labels after desktop collapse and dismisses with Escape", async () => {
    render(
      <AdminShell>
        <p>Workspace</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Admin navigation",
    });
    expect(
      within(dialog).getByRole("link", { name: "Suppliers" }).textContent,
    ).toContain("Suppliers");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("operational details", () => {
  it.each([
    ["ACTIVE", "success"],
    ["PAID", "success"],
    ["APPROVED", "success"],
    ["INACTIVE", "danger"],
    ["DISABLED", "danger"],
    ["PARTIALLY_PAID", "warning"],
    ["UNPAID", "warning"],
    ["PENDING_REVIEW", "warning"],
  ])("displays %s with the appropriate status tone", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it("shows readable saved details without internal source and record IDs", () => {
    render(
      <SnapshotDetails
        title="Vehicle details"
        value={{
          make: "Toyota",
          chassisVin: "CHASSIS123",
          source: "MANUAL",
          savedVehicleId: "internal-id",
          engineInfo: null,
        }}
      />,
    );
    expect(screen.getByText("Chassis / VIN")).toBeTruthy();
    expect(screen.getByText("CHASSIS123")).toBeTruthy();
    expect(screen.queryByText("internal-id")).toBeNull();
    expect(screen.queryByText("MANUAL")).toBeNull();
  });
});
