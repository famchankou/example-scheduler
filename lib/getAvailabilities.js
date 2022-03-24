import { knex } from "knex";
import {
  isValid, format, getDay, addMinutes,
  addDays, isWithinInterval, parseISO,
} from "date-fns";

export const knexClient = knex({
  client: "sqlite3",
  connection: ":memory:",
  useNullAsDefault: true,
});

export const migrate = () =>
  knexClient.schema.createTable("events", (table) => {
    table.increments();
    table.dateTime("starts_at").notNullable();
    table.dateTime("ends_at").notNullable();
    table.enum("kind", ["appointment", "opening"]).notNullable();
    table.boolean("weekly_recurring");
  });

export const DATE_FORMAT = "yyyy-MM-dd";
export const TIME_FORMAT = "H:mm";

export const TABLE_EVENTS = "events";
export const TYPE_OPENING = "opening";
export const TYPE_APPOINTMENT = "appointment";
export const DATE_KEY = "date";
export const DEFAULT_RANGE = 7; // days
export const DEFAULT_SLOT_DURATION = 30; // minutes
export const DAY_MINUTES = 24 * 60;

/**
 * Finds the availabilities of a calendar depending on openings and the scheduled events.
 * The main method takes a start date as input and looks for the availabilities over the next 7 days.
 * 
 * opening     - are the openings for a specific day and they can be recurring week by week (e.g. every monday starting from a certain date)
 * appointment - times when the doctor is already booked
 */
const getAvailabilities = async (date) => {
  const queryService = new EventsQueryService(knexClient);
  const schedule = new ScheduleBuilder(queryService);
  
  return await schedule
    .init(date)
    .getAvailableOpenings();
};

const getDateWithoutOffset = (dateStr) => {
  const date = dateStr ? new Date(dateStr) : new Date();
  return new Date(date.valueOf() + date.getTimezoneOffset() * 60 * 1000);
}
const validateStartDate = (date) => isValid(date) ? date : getDateWithoutOffset()
const formatScheduleKey = (date) => format(date, DATE_FORMAT)
const byEventDate = (a, b) => new Date(a.get(DATE_KEY)) - new Date(b.get(DATE_KEY));
const byHoursStr = (a, b) => new Date('1970/01/01 ' + a) - new Date('1970/01/01 ' + b);

class ScheduleEvent {
  #from = null;
  #to = null;

  constructor(data) {
    if (data) {
      Object.assign(this, data)
    }

    this.#from = parseISO(this.starts_at);
    this.#to = parseISO(this.ends_at);
    this.dayOfWeek = getDay(parseISO(this.starts_at));
    this.dateKey = formatScheduleKey(this.#from);
  }

  /**
   * Parses timeslots for a day with a default slot duration 30min
   * NB: Recurring day can have another date by valid time slots
   * @returns array of available time slots for a day, e.g: ["9:00", "14:00"]
   */
  getTimeslots(periodStartISO, periodEndISO) {
    let slots = [];
    let shift = 0;
    let eventFrom = this.#from;
    let eventTo = this.#to;

    if (this.weekly_recurring) {
      // if recurring time less than requested one of the same day, adjust recurring event from/to hours
      const periodTimeFrom = format(parseISO(periodStartISO), TIME_FORMAT);
      const isSameDay = getDay(parseISO(periodStartISO)) === this.dayOfWeek;
      const isStartTimeGreaterThanEvent = byHoursStr(periodTimeFrom, format(eventFrom, TIME_FORMAT)) > 0;
      
      if (isSameDay && isStartTimeGreaterThanEvent) {
        eventFrom = parseISO(periodStartISO);
        // update recurring event end date/time
        const hoursToReassign = eventTo.getHours();
        const minutesToReassign = eventTo.getMinutes();
        eventTo = parseISO(periodStartISO);
        eventTo.setHours(hoursToReassign);
        eventTo.setMinutes(minutesToReassign);
      }
    }
    
    if (eventFrom < eventTo) {
      while ((DAY_MINUTES * DEFAULT_SLOT_DURATION) > shift) {
        let startFrom = addMinutes(eventFrom, shift);
        if (!this.#isValidSlot(eventFrom, eventTo, startFrom)) {
          break;
        }
        
        slots.push(format(startFrom, TIME_FORMAT));
        shift += DEFAULT_SLOT_DURATION;
      }
    }
    
    return slots;
  }

  /**
   * Checks if the 30min slot is valid (within slot time range)
   * @param {*} from 
   * @param {*} to 
   * @param {*} startFrom 
   * @returns 
   */
  #isValidSlot(from, to, startFrom) {
    return isWithinInterval(
      addMinutes(startFrom, 1),
      {
        start: from,
        end: to,
      },
    )
  }
}

class ScheduleBuilder {
  #range = DEFAULT_RANGE;
  #schedule = [];
  #queryService = null;
  #startDateISO = null;
  #endDateISO = null;

  get weeklySchedule() {
    return this.#schedule;
  }

  constructor(queryService) {
    this.#queryService = queryService;
  }

  /**
   * Inits default schedule with start/end dates
   * @param {*} startDate 
   * @returns 
   */
  init(startDate) {
    const validatedStartDate = validateStartDate(startDate); // must be in ISO with zero shift
    this.#startDateISO = validatedStartDate.toISOString();
    this.#endDateISO = addDays(validatedStartDate, this.#range).toISOString();
    
    this.#buildSchedule(validatedStartDate);
    return this;
  }
  
  /**
   * Fills the schedule with data and extracts available openings,
   * init must be called to form a schedule for a given date range
   * @returns 
   */
  async getAvailableOpenings() {
    await Promise.all([
      this.#fetchData(this.#queryService.getNonRecurringOpenings.bind(this.#queryService)),
      this.#fetchData(this.#queryService.getRecurringOpenings.bind(this.#queryService)),
      this.#fetchData(this.#queryService.getAppointments.bind(this.#queryService))
    ]);

    return this.#schedule
      .sort(byEventDate)
      .reduce(this.#mapToAvailabilities, {});
  }


  /**
   * Maps the result schedule with openings/appointments into available openings
   * @param {*} schedule 
   * @param {*} day 
   * @returns 
   */
  #mapToAvailabilities(schedule, day) {
    const dayOpenings = day.get(TYPE_OPENING);
    const dayAppointments = day.get(TYPE_APPOINTMENT);
    const dateKey = day.get(DATE_KEY);
    
    schedule[dateKey] = [...dayOpenings]
      .filter(openingTime => !dayAppointments.has(openingTime))
      .sort(byHoursStr);
    
    return schedule;
  }

  /**
   * Parses event timeslots into the schedule
   * @param {*} event 
   */
  #parseIntoSchedule(event, periodStartISO, periodEndISO) {
    const dayMap = this.#schedule[event.dayOfWeek];
    const slots = event.getTimeslots(periodStartISO, periodEndISO);

    if (slots.length) {
      slots.forEach(
        dayMap.get(event.kind).add,
        dayMap.get(event.kind)
      );
    }
  }

  /**
   * Builds default schedule skeleton for a given start date for default range 7days
   * @param {*} startDate 
   */
  #buildSchedule(startDate) {
    this.#schedule = Array.from({ length: this.#range }, _ => new Map());

    // NB: this way only week schedule, greater range will overwrite the previous days
    for (let shift = 0; shift < this.#range; shift++) {
      const dateKey = formatScheduleKey(addDays(startDate, shift));
      // the day of week, 0 represents Sunday
      const dayOfWeek = getDay(new Date(addDays(startDate, shift)));
      const dayMap = this.#schedule[dayOfWeek];
      // use set for timeslots to skip duplicates
      dayMap.set(TYPE_OPENING, new Set());
      dayMap.set(TYPE_APPOINTMENT, new Set());
      dayMap.set(DATE_KEY, dateKey);
    }
  }

  /**
   * Fetches the events data and parses into the schedule
   * @param {*} request 
   */
  async #fetchData(request) {
    try {
      const events = await request(this.#startDateISO, this.#endDateISO);
      events
        .map(event => new ScheduleEvent(event))
        .forEach(event => this.#parseIntoSchedule(event, this.#startDateISO, this.#endDateISO));
    } catch (error) {
      console.error(error);
    }
  }
}

class EventsQueryService {
  #client = null;

  constructor(client) {
    this.#client = client;
  }

  async getNonRecurringOpenings(from, to) {
    return this.#client(TABLE_EVENTS)
      .where('kind', TYPE_OPENING)
      .andWhere(function () {
        // can also filter by subquery on appointments dates
        this
          .whereNull('weekly_recurring')
          .orWhere('weekly_recurring', false)
      })
      .andWhere('starts_at', '>=', from)
      .andWhere('ends_at', '<=', to)
      .orderBy('starts_at', 'asc');
  }

  // partition by a year period to limit recurring records
  async getRecurringOpenings() {
    return this.#client(TABLE_EVENTS)
      .where('kind', TYPE_OPENING)
      .andWhere('weekly_recurring', true)
      .orderBy('starts_at', 'asc');
  }

  async getAppointments(from, to) {
    return this.#client(TABLE_EVENTS)
      .where('kind', TYPE_APPOINTMENT)
      .andWhere('starts_at', '>=', from)
      .andWhere('ends_at', '<=', to)
      .whereNull('weekly_recurring')
      .orderBy('starts_at', 'asc');
  }
}

// Please keep this default export as it is.
export default getAvailabilities;
