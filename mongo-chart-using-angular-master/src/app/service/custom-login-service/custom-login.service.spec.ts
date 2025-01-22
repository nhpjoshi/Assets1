import { TestBed } from '@angular/core/testing';

import { CustomLoginService } from './custom-login.service';

describe('CustomLoginService', () => {
  let service: CustomLoginService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CustomLoginService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
