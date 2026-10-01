import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const nonblank = (min, max) => z.string().min(min).max(max).refine(v => v.trim().length > 0);
export const answerSchema = z.string().min(1).max(200)
  .refine(v => v.trim().length > 0 && !/[\r\n\v\f\u0085\u2028\u2029\0]/u.test(v));
export const expectedAnswerSchema = answerSchema.refine(v => v === v.trim());
export const loginSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(1).max(128),
}).strict();
export const attemptSchema = z.object({ answer: answerSchema }).strict();
const fields = {
  title: nonblank(3, 100), summary: nonblank(1, 240), question: nonblank(1, 5000),
  expectedAnswer: expectedAnswerSchema,
  difficulty: z.enum(['easy', 'medium', 'hard']),
  displayOrder: z.number().int().min(0).max(9999), isPublished: z.boolean(),
};
export const createChallengeSchema = z.object({ ...fields, isPublished: fields.isPublished.default(false) }).strict();
export const updateChallengeSchema = z.object(fields).partial().strict().refine(v => Object.keys(v).length > 0);
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'INVALID_INPUT', 'Invalid input. Check the field requirements.');
  return result.data;
}
export function parseId(raw) {
  if (!/^[1-9][0-9]{0,9}$/.test(raw) || Number(raw) > 2147483647) throw new HttpError(400, 'INVALID_ID', 'Invalid challenge ID.');
  return Number(raw);
}
export function requireJson(req, res, next) {
  if (!req.is('application/json')) return next(new HttpError(400, 'INVALID_INPUT', 'Send a JSON request body.'));
  next();
}
