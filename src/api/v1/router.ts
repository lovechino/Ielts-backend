import { Hono } from 'hono';

const v1Router = new Hono({ strict: false });

// User-facing routes (always deployed — read-only for most resources)
import courseRouter from './courses';
import vocabRouter from './vocabulary';
import uploadRouter from './upload';
import progressRouter from './progress';
import testRouter from './tests';
import authRouter from './auth';
import jobsRouter from './jobs';
import speakingRouter from './speaking';
import statsRouter from './stats';
import dailyRouter from './daily';
import aiRouter from './ai';
import dictionaryRouter from './dictionary';
import vaultRouter from './vault';
import shopRouter from './shop';
import paymentRouter from './payment';

v1Router.route('/courses', courseRouter);
v1Router.route('/vocabulary', vocabRouter);
v1Router.route('/upload', uploadRouter);
v1Router.route('/progress', progressRouter);
v1Router.route('/tests', testRouter);
v1Router.route('/auth', authRouter);
v1Router.route('/jobs', jobsRouter);
v1Router.route('/speaking', speakingRouter);
v1Router.route('/stats', statsRouter);
v1Router.route('/daily', dailyRouter);
v1Router.route('/ai', aiRouter);
v1Router.route('/dictionary', dictionaryRouter);
v1Router.route('/vault', vaultRouter);
v1Router.route('/shop', shopRouter);
v1Router.route('/payment', paymentRouter);

// Admin routes (mounted at same paths — guarded by ENABLE_ADMIN env + JWT + role check)
// In production (no ENABLE_ADMIN), all admin handlers return 404
// In local dev (ENABLE_ADMIN=true), admin handlers require role=admin
import { adminCourseRouter, adminVocabRouter, adminUploadRouter, adminJobRouter, adminDailyRouter, adminStatsRouter, adminShopRouter, adminUserRouter } from './admin';

v1Router.route('/courses', adminCourseRouter);
v1Router.route('/vocabulary', adminVocabRouter);
v1Router.route('/upload', adminUploadRouter);
v1Router.route('/jobs', adminJobRouter);
v1Router.route('/daily', adminDailyRouter);
v1Router.route('/stats', adminStatsRouter);
v1Router.route('/shop', adminShopRouter);
v1Router.route('/admin/users', adminUserRouter);

export default v1Router;
