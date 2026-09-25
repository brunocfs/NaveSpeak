// O Express 4 não trata promise rejeitada em handler/middleware async: o erro
// virava unhandledRejection e observability/shutdown.js derrubava o processo
// (ex.: ID gigante na URL dando "bigint out of range" no Postgres). Mesmo
// patch do pacote express-async-errors (sem a dependência): todo handler
// registrado num Layer passa a encaminhar a rejeição pro next(err), que cai
// no errorHandler normal. Precisa ser o PRIMEIRO import de index.js, antes de
// qualquer router registrar rotas.
// ponytail: remover ao migrar pro Express 5, que já faz isso nativamente.
import Layer from 'express/lib/router/layer.js';

function wrap(fn) {
  const wrapped = function (...args) {
    const ret = fn.apply(this, args);
    const next = args[args.length - 1]; // (req, res, next) ou (err, req, res, next)
    if (ret && typeof ret.catch === 'function' && typeof next === 'function') {
      ret.catch((err) => next(err));
    }
    return ret;
  };
  // Sub-router/app montado com use() é uma função com props (stack etc.).
  Object.assign(wrapped, fn);
  // Express decide se é error handler pelo fn.length - preserva.
  Object.defineProperty(wrapped, 'length', { value: fn.length });
  return wrapped;
}

Object.defineProperty(Layer.prototype, 'handle', {
  enumerable: true,
  get() {
    return this.__handle;
  },
  set(fn) {
    this.__handle = wrap(fn);
  },
});
