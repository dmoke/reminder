// Polls active reminders once per second and reports the set that is currently
// "due" (overdue and not done) to a callback. The main process turns that set
// into an always-on-top alert window. No Electron dependency here, so this is
// unit-testable under plain `node --test`.

class Scheduler {
  constructor(storage, onDue) {
    this.storage = storage;
    this.onDue = typeof onDue === "function" ? onDue : () => {};
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => this.tick(), 1000);
    this.tick(); // fire immediately so missed reminders surface at launch
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getDue(now = new Date()) {
    return this.storage.getActive().filter((reminder) => {
      if (reminder.done) return false;
      const time = new Date(reminder.time);
      return !isNaN(time.getTime()) && time <= now;
    });
  }

  tick() {
    // A throw here (e.g. inside an Electron call in the onDue handler) must not
    // kill the per-second interval or escape as an uncaught exception.
    try {
      this.onDue(this.getDue());
    } catch (err) {
      console.error("scheduler tick failed:", err);
    }
  }
}

module.exports = Scheduler;
