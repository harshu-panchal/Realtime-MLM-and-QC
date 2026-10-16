import Customer from "../models/customer.js";
import Setting from "../models/setting.js";
import logger from "../services/logger.js";
import { sendFCM } from "../modules/notifications/firebase.service.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // Check hourly

/**
 * Check customer subscriptions and dispatch push notifications for due/expiring subscriptions.
 * Cycle: Saturday 12:00 PM cutoff.
 */
export const checkCustomerWeeklySubscriptions = async () => {
    try {
        const now = new Date();
        const setting = await Setting.findOne().lean();
        const fee = Number(setting?.userWeeklySubscriptionFee ?? 50);

        if (fee <= 0) {
            return;
        }

        // 1. Mark expired subscriptions where expiresAt < now
        const expiredResult = await Customer.updateMany(
            {
                "weeklySubscription.status": { $in: ["active", "due"] },
                "weeklySubscription.expiresAt": { $lt: now }
            },
            {
                $set: { "weeklySubscription.status": "expired" }
            }
        );

        // 2. Find subscriptions expiring within 24 hours (or already expired/due) where notification hasn't been sent in last 20 hours
        const twentyFourHoursAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);

        const customersToNotify = await Customer.find({
            isActive: true,
            $or: [
                {
                    "weeklySubscription.status": "active",
                    "weeklySubscription.expiresAt": { $lte: twentyFourHoursAhead }
                },
                {
                    "weeklySubscription.status": { $in: ["due", "expired", "none"] }
                }
            ],
            $or: [
                { "weeklySubscription.lastNotificationSentAt": { $exists: false } },
                { "weeklySubscription.lastNotificationSentAt": null },
                { "weeklySubscription.lastNotificationSentAt": { $lt: twentyHoursAgo } }
            ]
        }).select("_id name phone fcmToken fcmTokenWeb weeklySubscription");

        if (!customersToNotify.length) {
            return;
        }

        logger.info(`[WeeklySubscriptionJob] Found ${customersToNotify.length} customer(s) to notify.`);

        for (const customer of customersToNotify) {
            const tokens = [customer.fcmToken, customer.fcmTokenWeb].filter(Boolean);
            if (tokens.length > 0) {
                try {
                    await sendFCM(tokens, {
                        title: "Weekly Subscription Due Reminder",
                        body: `Dear ${customer.name || "Customer"}, your weekly subscription payment of ₹${fee} is due before Saturday 12:00 PM. Please pay to keep enjoying uninterrupted service.`,
                        data: {
                            type: "WEEKLY_SUBSCRIPTION_DUE",
                            link: "/login",
                            fee: String(fee),
                        }
                    });
                } catch (pushErr) {
                    logger.warn(`[WeeklySubscriptionJob] FCM send error for customer ${customer._id}:`, pushErr.message);
                }
            }

            // Update status to due if was active, and update lastNotificationSentAt
            await Customer.findByIdAndUpdate(customer._id, {
                $set: {
                    ...(customer.weeklySubscription?.status === "active" ? { "weeklySubscription.status": "due" } : {}),
                    "weeklySubscription.lastNotificationSentAt": now
                }
            });
        }
    } catch (error) {
        logger.error("[WeeklySubscriptionJob] Error running weekly subscription job:", error);
    }
};

export const getCustomerWeeklySubscriptionJobHandler = () => checkCustomerWeeklySubscriptions;
export const getCustomerWeeklySubscriptionJobInterval = () => DEFAULT_INTERVAL_MS;
export const isCustomerWeeklySubscriptionJobEnabled = () => true;

export default checkCustomerWeeklySubscriptions;
