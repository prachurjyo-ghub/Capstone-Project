// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormDialog } from "./management";
import { ActionForm } from "./action-form";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@/lib/admin", () => ({ send: sendMock }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Example() {
  return (
    <FormDialog title="Add category" trigger={<button>Add category</button>}>
      <ActionForm
        endpoint="/admin/catalogue/categories"
        fields={[{ name: "name", label: "Category name" }]}
        submit="Save category"
      />
    </FormDialog>
  );
}

describe("admin form completion", () => {
  it("closes the form only after a successful save", async () => {
    sendMock.mockResolvedValueOnce({ id: "saved-category" });
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    fireEvent.change(screen.getByLabelText("Category name"), {
      target: { value: "Brakes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sendMock).toHaveBeenCalledWith(
      "/admin/catalogue/categories",
      "POST",
      { name: "Brakes" },
    );
  });

  it("keeps entered values and the form visible when saving fails", async () => {
    sendMock.mockRejectedValueOnce(new Error("Save failed"));
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    fireEvent.change(screen.getByLabelText("Category name"), {
      target: { value: "Brakes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Category name")).toHaveProperty(
      "value",
      "Brakes",
    );
  });
});
