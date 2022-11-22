import { ControllerError } from '../ControllerResponses/ControllerError';
import { ControllerSuccess } from '../ControllerResponses/ControllerSuccess';
import { ApiResponseFailure } from './ApiResponseFailure';
import { ApiResponseSuccess } from './ApiResponseSuccess';

export class ApiResponseFactory {
  static createResponseInstance(response: ControllerSuccess | ControllerError[]) {
    if (response instanceof ControllerSuccess) {
      return new ApiResponseSuccess(response);
    } else {
      return new ApiResponseFailure(response);
    }
  }
}