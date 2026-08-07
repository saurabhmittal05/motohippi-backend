import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import discoverRouter from "./discover.js";
import groupsRouter from "./groups.js";
import feedRouter from "./feed.js";
import marketplaceRouter from "./marketplace.js";
import insuranceRouter from "./insurance.js";
import messagesRouter from "./messages.js";
import notificationsRouter from "./notifications.js";
import dashboardRouter from "./dashboard.js";
import searchRouter from "./search.js";
import uploadRouter from "./upload.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(discoverRouter);
router.use(groupsRouter);
router.use(feedRouter);
router.use(marketplaceRouter);
router.use(insuranceRouter);
router.use(messagesRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);
router.use(searchRouter);
router.use(uploadRouter);

export default router;
