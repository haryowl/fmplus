import { describe, expect, it } from "vitest";
import {
  buildAssignedMessage,
  moneyLinesForNotify,
  sumJobGoodsSellForNotify,
} from "../../server/dispatch-notify.mjs";
import {
  fieldFinishLabel,
  fieldStartLabel,
  isPassengerDispatchStop,
} from "./dispatch";

describe("WhatsApp money lines", () => {
  it("omits money when entitlement off", () => {
    expect(
      moneyLinesForNotify(
        {
          fareEstimate: 50000,
          stops: [{ orderId: "o1", lines: [{ qty: 2, unitPrice: 1000, lineAmount: 2000 }] }],
        },
        { showMoney: false },
      ),
    ).toEqual([]);
  });

  it("includes fare and goods when on", () => {
    expect(
      moneyLinesForNotify(
        {
          fareEstimate: 50000,
          stops: [
            {
              orderId: "o1",
              lines: [{ qty: 2, unitPrice: 1000, lineAmount: 2000 }],
            },
            {
              orderId: "o1",
              role: "drop",
              lines: [{ qty: 2, unitPrice: 1000, lineAmount: 2000 }],
            },
          ],
        },
        { showMoney: true },
      ),
    ).toEqual(["Fare: Rp 50.000", "Goods: Rp 2.000"]);
  });

  it("dedupes pickup/drop cargo for goods total", () => {
    expect(
      sumJobGoodsSellForNotify({
        stops: [
          { orderId: "a", lines: [{ lineAmount: 10000 }] },
          { orderId: "a", lines: [{ lineAmount: 10000 }] },
        ],
      }),
    ).toBe(10000);
  });

  it("puts money into assigned message when enabled", () => {
    const msg = buildAssignedMessage(
      {
        title: "JOB-1",
        serviceDate: "2026-10-14",
        fareActual: 75000,
        seatCapacity: 4,
        seatsUsed: 2,
        stops: [{ id: "1" }, { id: "2" }],
        assigneeDisplayName: "Andi",
      },
      "demo",
      { showMoney: true },
    );
    expect(msg).toContain("Fare: Rp 75.000");
    expect(msg).toContain("2 seats");
    expect(msg).not.toContain("m³");
  });
});

describe("passenger Field copy", () => {
  it("labels pickup Boarded and drop Alighted", () => {
    const pickup = { orderProfile: "passenger" as const, role: "pickup" as const };
    const drop = { orderProfile: "passenger" as const, role: "drop" as const };
    expect(isPassengerDispatchStop(pickup)).toBe(true);
    expect(fieldFinishLabel(pickup)).toBe("Boarded");
    expect(fieldFinishLabel(drop)).toBe("Alighted");
    expect(fieldStartLabel(pickup)).toBe("Board");
    expect(fieldStartLabel(drop)).toBe("Start");
    expect(fieldFinishLabel({ orderProfile: "cargo", role: "drop" })).toBe("Finish");
  });
});
