import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { CreditService } from "./credit.service.js";

describe("commission calculation", () => {
  const service = new CreditService({} as PrismaClient);

  it("uses the confirmed multi-unit eligible amount", () => {
    expect(
      service.calculateCommission(new Prisma.Decimal("3000.00"), 1000).toFixed(2),
    ).toBe("300.00");
  });

  it("rounds half up deterministically to two decimal places", () => {
    expect(service.calculateCommission(new Prisma.Decimal("0.05"), 1000).toFixed(2)).toBe(
      "0.01",
    );
  });

  it("does not use binary floating-point arithmetic for large values", () => {
    expect(
      service.calculateCommission(new Prisma.Decimal("9999999999.99"), 1275).toFixed(2),
    ).toBe("1275000000.00");
  });
});
