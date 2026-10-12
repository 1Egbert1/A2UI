import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';

const app = new Koa();
const router = new Router();

router.get('/health', (ctx) => {
  ctx.body = { status: 'ok' };
});

app.use(bodyParser());
app.use(router.routes()).use(router.allowedMethods());

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.listen(PORT, () => {
  console.log(`A2UI Playground Server is running at http://localhost:${PORT}`);
});
