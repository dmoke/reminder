const { Notification, nativeImage } = require("electron");
const path = require("path");

class Scheduler {
  constructor(storage) {
    this.storage = storage;
    this.interval = null;
    // Reminders that have already been notified this session. We never re-fire
    // a notification for the same reminder until it is acted on (completed /
    // snoozed), which moves it out of the active set or into the future.
    this.pending = new Set();
  }

  start() {
    this.interval = setInterval(() => {
      this.checkReminders();
    }, 1000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  checkReminders() {
    const now = new Date();
    const active = this.storage.getActive();

    // Self-heal the suppression set: re-arm any reminder that was rescheduled
    // into the future (snoozed/edited from the main window, which never touches
    // this Set) or that no longer exists (deleted/archived). Without this, a
    // fired-but-ignored reminder would stay suppressed for the whole session.
    if (this.pending.size) {
      const byId = new Map(active.map((r) => [r.id, r]));
      for (const id of this.pending) {
        const reminder = byId.get(id);
        if (!reminder) {
          this.pending.delete(id);
          continue;
        }
        const time = new Date(reminder.time);
        if (!isNaN(time.getTime()) && time > now) {
          this.pending.delete(id);
        }
      }
    }

    active.forEach((reminder) => {
      if (reminder.done) return;
      if (this.pending.has(reminder.id)) return;
      const time = new Date(reminder.time);
      if (!isNaN(time.getTime()) && time <= now) {
        this.triggerReminder(reminder);
      }
    });
  }

  triggerReminder(reminder) {
    this.pending.add(reminder.id);
    const image = nativeImage.createFromPath(
      path.join(__dirname, "assets", "icon.ico"),
    );
    const notification = new Notification({
      title: "Reminder",
      body: reminder.text,
      ...(image && !image.isEmpty() ? { icon: image } : {}),
      actions: [
        { type: "button", text: "Complete" },
        { type: "button", text: "Snooze 10 min" },
      ],
    });

    notification.on("action", (event, index) => {
      if (index === 0) {
        // Complete: archive the reminder
        this.storage.archive(reminder.id);
      } else {
        // Snooze: reschedule for 10 minutes from now
        const snoozeTime = new Date(Date.now() + 10 * 60 * 1000);
        this.storage.update(reminder.id, { time: snoozeTime.toISOString() });
      }
      // Acting on the reminder removes it from the active set or pushes it into
      // the future, so allow it to be tracked again from a clean slate.
      this.pending.delete(reminder.id);
    });

    notification.show();
  }
}

module.exports = Scheduler;
