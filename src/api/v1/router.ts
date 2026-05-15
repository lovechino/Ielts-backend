import { Hono } from 'hono';

const v1Router = new Hono({ strict: false });

// We will mount sub-routers here
import courseRouter from './courses';
import vocabRouter from './vocabulary';
import uploadRouter from './upload';
import progressRouter from './progress';
import testRouter from './tests';
import authRouter from './auth';
import jobsRouter from './jobs';

v1Router.route('/courses', courseRouter);
v1Router.route('/vocabulary', vocabRouter);
v1Router.route('/upload', uploadRouter);
v1Router.route('/progress', progressRouter);
v1Router.route('/tests', testRouter);
v1Router.route('/auth', authRouter);
v1Router.route('/jobs', jobsRouter);

export default v1Router;
