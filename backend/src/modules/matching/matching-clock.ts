export interface MatchingClock {
  now(): Date;
}

export class SystemMatchingClock implements MatchingClock {
  now(): Date {
    return new Date();
  }
}
