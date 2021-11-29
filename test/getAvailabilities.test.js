import getAvailabilities, {
  knexClient,
  migrate,
} from "../lib/getAvailabilities";

describe("getAvailabilities", () => {
  let availabilities;

  beforeAll(() => migrate());

  beforeEach(() => knexClient("events").truncate());

  afterAll(() => knexClient.destroy());

  describe("skeleton", () => {
    beforeAll(async () => {
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
    });

    it("returns an Object", () => {
      expect(typeof availabilities === "object").toBe(true);
      expect(Array.isArray(availabilities)).toBe(false);
    });

    it("key is a date string with format YYYY/MM/DD", () => {
      expect(Object.keys(availabilities)[0]).toEqual("2020-01-01");
    });

    it("value is an Array", () => {
      expect(Object.values(availabilities)[0]).toEqual([]);
    });

    it("returns the next seven days", () => {
      expect(Object.values(availabilities).length).toBe(7);
    });

    it("full flow", () => {
      expect(availabilities["2020-01-01"]).toEqual([]);
      expect(availabilities["2020-01-02"]).toEqual([]);
      expect(availabilities["2020-01-03"]).toEqual([]);
      expect(availabilities["2020-01-04"]).toEqual([]);
      expect(availabilities["2020-01-05"]).toEqual([]);
      expect(availabilities["2020-01-06"]).toEqual([]);
      expect(availabilities["2020-01-07"]).toEqual([]);
    });
  });

  describe("openings", () => {
    it("one opening", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 11:00").toISOString(),
          ends_at: new Date("2020-01-01 11:30").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual(["11:00"]);
    });

    it("30 minutes slots", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 11:00").toISOString(),
          ends_at: new Date("2020-01-01 12:00").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual(["11:00", "11:30"]);
    });

    it("several openings on the same day", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 11:00").toISOString(),
          ends_at: new Date("2020-01-01 12:00").toISOString(),
        },
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 14:00").toISOString(),
          ends_at: new Date("2020-01-01 15:00").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual([
        "11:00",
        "11:30",
        "14:00",
        "14:30",
      ]);
    });

    it("format", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 09:00").toISOString(),
          ends_at: new Date("2020-01-01 09:30").toISOString(),
        },
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 14:00").toISOString(),
          ends_at: new Date("2020-01-01 14:30").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual(["9:00", "14:00"]);
    });
  });

  describe("appointments", () => {
    beforeEach(
      async () =>
        await knexClient("events").insert([
          {
            kind: "opening",
            starts_at: new Date("2020-01-01 09:00").toISOString(),
            ends_at: new Date("2020-01-01 10:00").toISOString(),
          },
        ])
    );

    it("an appointment of one slot", async () => {
      await knexClient("events").insert([
        {
          kind: "appointment",
          starts_at: new Date("2020-01-01 09:00").toISOString(),
          ends_at: new Date("2020-01-01 09:30").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual(["9:30"]);
    });

    it("an appointment of several slots", async () => {
      await knexClient("events").insert([
        {
          kind: "appointment",
          starts_at: new Date("2020-01-01 09:00").toISOString(),
          ends_at: new Date("2020-01-01 10:00").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual([]);
    });

    it("several appointments on the same day", async () => {
      await knexClient("events").insert([
        {
          kind: "appointment",
          starts_at: new Date("2020-01-01 09:00").toISOString(),
          ends_at: new Date("2020-01-01 09:30").toISOString(),
        },
        {
          kind: "appointment",
          starts_at: new Date("2020-01-01 09:30").toISOString(),
          ends_at: new Date("2020-01-01 10:00").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual([]);
    });
  });

  describe("weekly recurring openings", () => {
    it("weekly recurring are taken into account day 1", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 09:00").toISOString(),
          ends_at: new Date("2020-01-01 09:30").toISOString(),
          weekly_recurring: true,
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-01 00:00"));
      expect(availabilities["2020-01-01"]).toEqual(["9:00"]);
    });

    it("weekly recurring are recurring", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 09:00").toISOString(),
          ends_at: new Date("2020-01-01 09:30").toISOString(),
          weekly_recurring: true,
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-08 00:00"));
      expect(availabilities["2020-01-08"]).toEqual(["9:00"]);
    });

    it("non weekly recurring are not recurring", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2020-01-01 09:00").toISOString(),
          ends_at: new Date("2020-01-01 09:30").toISOString(),
          weekly_recurring: false,
        },
      ]);
      availabilities = await getAvailabilities(new Date("2020-01-08 00:00"));
      expect(availabilities["2020-01-08"]).toEqual([]);
    });
  });

  // Add tests to make sure all nominal cases are covered
  describe("nominal cases", () => {
    it("start date/time the same as opening date/time", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-08 09:00").toISOString(),
          ends_at: new Date("2021-10-08 09:30").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-08 09:00"));
      expect(availabilities["2021-10-08"]).toEqual(["9:00"]);
    });

    it("start date/time the same as opening end date/time", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-08 18:00").toISOString(),
          ends_at: new Date("2021-10-08 18:30").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-08 18:30"));
      expect(availabilities["2021-10-08"]).toEqual([]);
    });

    it("start date/time in the middle of opening date/time", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-08 18:00").toISOString(),
          ends_at: new Date("2021-10-08 18:30").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-08 18:15"));
      expect(availabilities["2021-10-08"]).toEqual([]);
    });

    it("start date/time greater than opening start date/time", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-01 09:00").toISOString(),
          ends_at: new Date("2021-10-01 09:30").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-01 15:00"));
      expect(availabilities["2021-10-01"]).toEqual([]);
    });

    it("start date/time greater than recurring opening start date/time (same day)", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-01 09:00").toISOString(),
          ends_at: new Date("2021-10-01 09:30").toISOString(),
          weekly_recurring: true,
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-08 09:00"));
      expect(availabilities["2021-10-08"]).toEqual(["09:00"]);
    });

    it("start date/time the same as opening start and appointment end date/time", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 11:00").toISOString(),
          ends_at: new Date("2021-10-03 11:30").toISOString(),
        },
        {
          kind: "appointment",
          starts_at: new Date("2021-10-03 10:00").toISOString(),
          ends_at: new Date("2021-10-03 11:00").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-03 11:00"));
      expect(availabilities["2021-10-03"]).toEqual(["11:00"]);
    });

    it("opening hours intersect (should have no duplicates)", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 09:00").toISOString(),
          ends_at: new Date("2021-10-03 10:00").toISOString(),
        },
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 09:30").toISOString(),
          ends_at: new Date("2021-10-03 12:00").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-03 06:00"));
      expect(availabilities["2021-10-03"]).toEqual(["9:00", "9:30", "10:00", "10:30", "11:00", "11:30"]);
    });

    it("opening/appointments hours intersect (should have no duplicates)", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 09:00").toISOString(),
          ends_at: new Date("2021-10-03 10:00").toISOString(),
        },
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 09:30").toISOString(),
          ends_at: new Date("2021-10-03 11:00").toISOString(),
        },
        {
          kind: "appointment",
          starts_at: new Date("2021-10-03 09:30").toISOString(),
          ends_at: new Date("2021-10-03 11:30").toISOString(),
        },
        {
          kind: "appointment",
          starts_at: new Date("2021-10-03 10:30").toISOString(),
          ends_at: new Date("2021-10-03 11:00").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-03 06:00"));
      expect(availabilities["2021-10-03"]).toEqual(["9:00"]);
    });

    it("recurring opening time intersects with one-time opening (should have no duplicates)", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 09:00").toISOString(),
          ends_at: new Date("2021-10-03 10:00").toISOString(),
        },
        {
          kind: "opening",
          starts_at: new Date("2021-09-26 08:30").toISOString(),
          ends_at: new Date("2021-09-26 09:00").toISOString(),
          weekly_recurring: true,
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-01 06:00"));
      expect(availabilities["2021-10-03"]).toEqual(["8:30", "9:00", "9:30"]);
    });
  });

  // Add tests to cover all edge cases you can identify
  describe("edge cases", () => {
    const wholeDayTimeSlots = [
      "0:00",  "0:30",  "1:00",  "1:30",  "2:00",  "2:30",  "3:00",  "3:30",  "4:00",  "4:30",  "5:00",  "5:30", "6:00",
      "6:30",  "7:00",  "7:30",  "8:00",  "8:30",  "9:00",  "9:30",  "10:00", "10:30", "11:00", "11:30", "12:00",
      "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00",
      "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00", "23:30"
    ];
    const oneWeekOpenings = [
      {
        kind: "opening",
        starts_at: new Date("2021-10-03 00:00").toISOString(),
        ends_at: new Date("2021-10-03 23:59").toISOString(),
      },
      {
        kind: "opening",
        starts_at: new Date("2021-10-04 00:00").toISOString(),
        ends_at: new Date("2021-10-04 23:59").toISOString(),
      },
      {
        kind: "opening",
        starts_at: new Date("2021-10-05 00:00").toISOString(),
        ends_at: new Date("2021-10-05 23:59").toISOString(),
      },
      {
        kind: "opening",
        starts_at: new Date("2021-10-06 00:00").toISOString(),
        ends_at: new Date("2021-10-06 23:59").toISOString(),
      },
      {
        kind: "opening",
        starts_at: new Date("2021-10-07 00:00").toISOString(),
        ends_at: new Date("2021-10-07 23:59").toISOString(),
      },
      {
        kind: "opening",
        starts_at: new Date("2021-10-08 00:00").toISOString(),
        ends_at: new Date("2021-10-08 23:59").toISOString(),
      },
      {
        kind: "opening",
        starts_at: new Date("2021-10-09 00:00").toISOString(),
        ends_at: new Date("2021-10-09 23:59").toISOString(),
      },
    ];
    const oneWeekAppointments = [
      {
        kind: "appointment",
        starts_at: new Date("2021-10-03 00:00").toISOString(),
        ends_at: new Date("2021-10-03 23:59").toISOString(),
      },
      {
        kind: "appointment",
        starts_at: new Date("2021-10-04 00:00").toISOString(),
        ends_at: new Date("2021-10-04 23:59").toISOString(),
      },
      {
        kind: "appointment",
        starts_at: new Date("2021-10-05 00:00").toISOString(),
        ends_at: new Date("2021-10-05 23:59").toISOString(),
      },
      {
        kind: "appointment",
        starts_at: new Date("2021-10-06 00:00").toISOString(),
        ends_at: new Date("2021-10-06 23:59").toISOString(),
      },
      {
        kind: "appointment",
        starts_at: new Date("2021-10-07 00:00").toISOString(),
        ends_at: new Date("2021-10-07 23:59").toISOString(),
      },
      {
        kind: "appointment",
        starts_at: new Date("2021-10-08 00:00").toISOString(),
        ends_at: new Date("2021-10-08 23:59").toISOString(),
      },
      {
        kind: "appointment",
        starts_at: new Date("2021-10-09 00:00").toISOString(),
        ends_at: new Date("2021-10-09 23:59").toISOString(),
      },
    ];
    
    it("fill with openings for whole day from 00:00 to 23:59", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 00:00").toISOString(),
          ends_at: new Date("2021-10-03 23:59").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-01 06:00"));
      expect(availabilities["2021-10-03"]).toEqual(wholeDayTimeSlots);
    });

    it("fill with one opening from 00:00 to 23:59 and one appointment from 00:00 to 23:59", async () => {
      await knexClient("events").insert([
        {
          kind: "opening",
          starts_at: new Date("2021-10-03 00:00").toISOString(),
          ends_at: new Date("2021-10-03 23:59").toISOString(),
        },
        {
          kind: "appointment",
          starts_at: new Date("2021-10-03 00:00").toISOString(),
          ends_at: new Date("2021-10-03 23:59").toISOString(),
        },
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-02 23:00"));
      expect(availabilities["2021-10-03"]).toEqual([]);
    });

    it("fill openings for the whole week from 00:00 +6 days 23:59", async () => {
      await knexClient("events").insert([
        ...oneWeekOpenings,
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-03 00:00"));
      expect(availabilities["2021-10-03"]).toEqual(wholeDayTimeSlots);
      expect(availabilities["2021-10-04"]).toEqual(wholeDayTimeSlots);
      expect(availabilities["2021-10-05"]).toEqual(wholeDayTimeSlots);
      expect(availabilities["2021-10-06"]).toEqual(wholeDayTimeSlots);
      expect(availabilities["2021-10-07"]).toEqual(wholeDayTimeSlots);
      expect(availabilities["2021-10-08"]).toEqual(wholeDayTimeSlots);
      expect(availabilities["2021-10-09"]).toEqual(wholeDayTimeSlots);
    });

    it("fill openings/appointments for the whole week from 00:00 +6 days 23:59", async () => {
      await knexClient("events").insert([
        ...oneWeekOpenings,
        ...oneWeekAppointments,
      ]);
      availabilities = await getAvailabilities(new Date("2021-10-03 00:00"));
      expect(availabilities["2021-10-03"]).toEqual([]);
      expect(availabilities["2021-10-04"]).toEqual([]);
      expect(availabilities["2021-10-05"]).toEqual([]);
      expect(availabilities["2021-10-06"]).toEqual([]);
      expect(availabilities["2021-10-07"]).toEqual([]);
      expect(availabilities["2021-10-08"]).toEqual([]);
      expect(availabilities["2021-10-09"]).toEqual([]);
    });
  });
});
