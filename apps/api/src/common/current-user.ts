import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthUser } from "./roles";

// Every business query must filter by user.clinicaId taken from here, never from the request body.
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
