const { Notification } = require("electron");
const path = require("path");

class Scheduler {
  constructor(storage, onAction = null) {
    this.storage = storage;
    this.interval = null;
    this.pending = new Set();
    this.onAction = onAction;
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
    const reminders = this.storage.getActive();
    const now = new Date();
    reminders.forEach((reminder) => {
      if (!reminder.done && new Date(reminder.time) <= now) {
        if (this.pending.has(reminder.id)) return;
        this.triggerReminder(reminder);
      }
    });
  }

  triggerReminder(reminder) {
    this.pending.add(reminder.id);
    let handled = false;
    const iconPath = path.join(__dirname, "assets", "icon.ico");
    const notification = new Notification({
      title: "Reminder",
      body: reminder.text,
      icon: iconPath,
      actions: [
        { type: "button", text: "Complete" },
        { type: "button", text: "Snooze 10min" },
      ],
    });

    notification.on("action", (event, index) => {
      handled = true;
      if (index === 0) {
        // Complete: archive the reminder
        this.storage.archive(reminder.id);
      } else {
        // Snooze: reschedule for 10 minutes later
        const snoozeTime = new Date(Date.now() + 10 * 60 * 1000);
        this.storage.update(reminder.id, { time: snoozeTime.toISOString() });
      }
      this.pending.delete(reminder.id);
      if (this.onAction) {
        this.onAction();
      }
    });

    notification.on("close", () => {
      if (!handled) {
        this.pending.delete(reminder.id);
      }
    });

    notification.show();
  }
}

module.exports = Scheduler;
