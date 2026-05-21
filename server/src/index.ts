import { createServer } from './app';

const server = createServer();

const start = async () => {
  try {
    const port = Number(process.env.PORT ?? 3001);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error('Invalid PORT value');
    }

    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
