import { type NextFunction, type Request, type Response } from "express";
import { ZodTypeAny } from "zod";

function parseOrNext<T>(
  schema: ZodTypeAny,
  value: unknown,
  assign: (parsed: T) => void,
  next: NextFunction,
) {
  try {
    assign(schema.parse(value) as T);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    parseOrNext(schema, req.body, (parsed) => {
      req.body = parsed;
    }, next);
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    parseOrNext(schema, req.query, (parsed) => {
      req.query = parsed;
    }, next);
  };
}
