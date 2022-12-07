import { LineStream } from 'byline';
import { AlphaVantageApiService } from '../services/AlphaVantageApiService';
import { YahooApiService } from '../services/YahooApiService';
import { BaseError } from '../utils/errors/BaseError';
import { NotFoundError } from '../utils/errors/NotFoundError';
import { UnknownError } from '../utils/errors/UnknownError';
import { ControllerSuccess } from '../utils/types/ControllerResponses/ControllerSuccess';
import {
  CompareStockBySymbols,
  GetProjectedGains,
  GetStockBySymbol,
  GetStockHistoryBySymbol,
  HistoricPrices,
} from '../utils/types/EndpointsTypes';
import { ParameterValidator } from '../utils/validations/ParameterValidator';
import { ValidatationTypes } from '../utils/validations/Validators';

export class ApiController {
  static instance: ApiController;

  private constructor(
    private yahooApiService = new YahooApiService(),
    private alphaApiService: AlphaVantageApiService = new AlphaVantageApiService()
  ) {}

  static getInstance(yahooApiService?: YahooApiService, alphaApiService?: AlphaVantageApiService): ApiController {
    if (!ApiController.instance) {
      ApiController.instance = new ApiController(yahooApiService, alphaApiService);
    }
    return ApiController.instance;
  }

  private createErrorObject(errors: BaseError | BaseError[]): BaseError[] {
    if ('length' in errors) {
      return errors;
    } else {
      return [errors];
    }
  }

  private createSuccessObject<EndpointsResponseTypes>(result: EndpointsResponseTypes) {
    return new ControllerSuccess(result);
  }

  async getStockBySymbol(stock_name: string): Promise<ControllerSuccess<GetStockBySymbol> | BaseError[]> {
    const validationErrors = ParameterValidator.getValidationErrors([ValidatationTypes.STRING, { stock_name }]);
    if (validationErrors !== undefined) {
      return this.createErrorObject(validationErrors);
    }

    try {
      const result = await this.yahooApiService.getStockBySymbol(stock_name);

      return this.createSuccessObject<GetStockBySymbol>({
        name: result.symbol,
        lastPrice: result.regularMarketPrice,
        pricedAt: new Date(Number(result.regularMarketTime.toString() + '000')).toISOString(),
      });
    } catch (err: any) {
      const isANotFoundError: boolean = err.code === 'Not Found';

      return isANotFoundError
        ? this.createErrorObject(new NotFoundError({ stock_name }))
        : this.createErrorObject(new UnknownError());
    }
  }

  async compareStockBySymbols(
    stock_name: string,
    stocks: string[]
  ): Promise<ControllerSuccess<CompareStockBySymbols> | BaseError[]> {
    //No need for validation, getstockbysymbol already does it.
    const successArray: GetStockBySymbol[] = [];
    const errorArray: BaseError[] = [];

    for (const stock of [stock_name, ...stocks]) {
      const result = await this.getStockBySymbol(stock);

      if (result instanceof ControllerSuccess) {
        successArray.push(result.getResult());
      } else {
        errorArray.push(...result);
      }
    }

    const hasErrors = errorArray.length > 0;

    return hasErrors
      ? this.createErrorObject(errorArray)
      : this.createSuccessObject<CompareStockBySymbols>({ lastPrices: successArray });
  }

  async getStockHistoryBySymbol(
    stock_name: string,
    from: string,
    to: string
  ): Promise<ControllerSuccess<GetStockHistoryBySymbol> | BaseError[]> {
    const validationErrors = ParameterValidator.getValidationErrors(
      [ValidatationTypes.STRING, { stock_name }],
      [ValidatationTypes.DATE, { from }],
      [ValidatationTypes.DATE, { to }],
      [ValidatationTypes.IS_NOT_WEEKEND, { from }],
      [ValidatationTypes.IS_NOT_WEEKEND, { to }],
      [ValidatationTypes.NOT_TODAY_OR_AFTER, { from }],
      [ValidatationTypes.NOT_TODAY_OR_AFTER, { to }],
      [ValidatationTypes.DATE_INTERVAL, { from_to: [from, to] }]
    );

    if (validationErrors !== undefined) {
      return this.createErrorObject(validationErrors);
    }

    try {
      const historyStream = await this.alphaApiService.getStockHistoryAsStream(stock_name);
      const prices = await new HistorySearcher().searchTimeIntervalInHistory(historyStream, from, to);

      return new ControllerSuccess<GetStockHistoryBySymbol>({
        name: stock_name.toUpperCase(),
        prices: prices,
      });
    } catch (error: any) {
      if (error === 'fromto') {
        return this.createErrorObject([new NotFoundError({ from }), new NotFoundError({ to })]);
      } else if (error === 'stock') {
        return this.createErrorObject([new NotFoundError({ stock_name })]);
      } else {
        return this.createErrorObject(new UnknownError());
      }
    }
  }

  async projectGains(
    stock_name: string,
    purchasedAmount: string,
    purchasedAt: string
  ): Promise<ControllerSuccess<GetProjectedGains> | BaseError[]> {
    const validationErrors = ParameterValidator.getValidationErrors(
      [ValidatationTypes.STRING, { stock_name }],
      [ValidatationTypes.POSITIVE_NUMBER, { purchasedAmount }],
      [ValidatationTypes.DATE, { purchasedAt }],
      [ValidatationTypes.IS_NOT_WEEKEND, { purchasedAt }],
      [ValidatationTypes.NOT_TODAY_OR_AFTER, { purchasedAt }]
    );

    if (validationErrors !== undefined) {
      return validationErrors;
    }

    const [todaysValue, onDateValue] = await Promise.all([
      this.getStockBySymbol(stock_name),
      this.getStockHistoryBySymbol(stock_name, purchasedAt, purchasedAt),
    ]);
    let totalToday = undefined,
      totalOnDate = undefined;

    if (todaysValue instanceof ControllerSuccess) {
      totalToday = todaysValue.getResult().lastPrice * Number(purchasedAmount);
    } else {
      return todaysValue;
    }

    if (onDateValue instanceof ControllerSuccess) {
      totalOnDate = onDateValue.getResult().prices[0].closing * Number(purchasedAmount);
    } else {
      // The only case where there's two errors is when date is not found (to and from)
      // In that case, im remodeling the error so it doesnt show as a weird "unknown to and from"
      // parameter that the user have never sended.
      const didNotFindDate = onDateValue[0] instanceof NotFoundError && onDateValue.length === 2;
      if (didNotFindDate) {
        return [new NotFoundError({ purchasedAt })];
      }
      return onDateValue;
    }

    todaysValue.getResult().pricedAt;
    return new ControllerSuccess({
      name: stock_name.toUpperCase(),
      lastPrice: todaysValue.getResult().lastPrice,
      priceAtDate: onDateValue.getResult().prices[0].closing,
      purchasedAmount: Number(purchasedAmount),
      purchasedAt: new Date(purchasedAt).toISOString(),
      capitalGains: Number((totalToday - totalOnDate).toFixed(2)),
    });
  }
}

//idk where to put this ;-;
class HistorySearcher {
  private searchingState = { reading: false, ending: false };

  private addLineToResult(result: { result: string }, line: string) {
    result.result += line;
  }

  private isScanningThrougSearchingInterval() {
    return this.searchingState.reading === true;
  }

  private removeLastCommaIfNecessary(result: { result: string }) {
    if (result.result.endsWith(',')) {
      result.result = result.result.slice(0, -1);
    }
  }

  private startReading() {
    this.searchingState.reading = true;
  }

  private startLookingForLastObject() {
    this.searchingState.ending = true;
  }

  private shouldIgnoreForPerformance() {
    return this.searchingState.reading === false;
  }

  private foundStartOfWantedInterval(line: string, firstDateToAppearInStream: string) {
    return line.includes(firstDateToAppearInStream) && line.includes('{'); // "date": {
  }
  private finishedReadingLastObject(line: string) {
    return this.searchingState.ending && line.includes('}');
  }

  private foundEndOfWantedInterval(line: string, lastDateToAppearInStream: string) {
    return line.includes(lastDateToAppearInStream) && line.includes('{'); // "date": {
  }

  private didntFoundStockInDatabase(line: string) {
    return line.includes('Error Message');
  }

  private getUnformatedJSONHistoryInterval(rawPricesObj: string) {
    return JSON.parse(rawPricesObj);
  }

  private formatJSONHistoryObject(unformatedObject: any): HistoricPrices[] {
    return Object.keys(unformatedObject).map((key) => {
      const saidObj = unformatedObject[key];
      return {
        opening: Number(saidObj['1. open']),
        high: Number(saidObj['2. high']),
        low: Number(saidObj['3. low']),
        closing: Number(saidObj['4. close']),
        pricedAt: new Date(key).toISOString(),
      };
    });
  }

  async searchTimeIntervalInHistory(historyStream: LineStream, unformatedFromDate: string, unformatedToDate: string) {
    const formatedToDate = new Date(unformatedToDate).toISOString().split('T')[0];
    const formatedFromDate = new Date(unformatedFromDate).toISOString().split('T')[0];

    const result = await this.scanStreamForTimeInterval(historyStream, formatedToDate, formatedFromDate);
    const unformatedObject = this.getUnformatedJSONHistoryInterval(result);
    return this.formatJSONHistoryObject(unformatedObject);
  }

  private async scanStreamForTimeInterval(
    historyStream: LineStream,
    firstDateToAppearInStream: string,
    lastDateToAppearInStream: string
  ) {
    const result = { result: '{' }; //being a object in can pass it though

    return new Promise<string>((resolve, reject) => {
      historyStream.on('data', (lineBuffer: Buffer) => {
        const line = lineBuffer.toString();

        if (this.didntFoundStockInDatabase(line)) {
          reject('stock');
        }

        if (this.foundStartOfWantedInterval(line, firstDateToAppearInStream)) {
          this.startReading();
        }

        if (this.shouldIgnoreForPerformance()) {
          return;
        }

        if (this.foundEndOfWantedInterval(line, lastDateToAppearInStream)) {
          this.startLookingForLastObject();
        }

        if (this.isScanningThrougSearchingInterval()) {
          this.addLineToResult(result, line);
        }

        if (this.finishedReadingLastObject(line)) {
          this.removeLastCommaIfNecessary(result);
          result.result += '}';
          resolve(result.result);
        }
      });

      historyStream.on('end', () => {
        reject('fromto');
      });
    });
  }
}
