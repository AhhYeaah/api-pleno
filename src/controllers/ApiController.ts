import { AlphaVantageApiService } from '../services/AlphaVantageApiService';
import { YahooApiService } from '../services/YahooApiService';
import { BaseError } from '../utils/errors/BaseError';
import { NotFoundError } from '../utils/errors/NotFoundError';
import { UnknownError } from '../utils/errors/UnknownError';
import { ControllerSuccess } from '../utils/types/ControllerResponses/ControllerSuccess';
import {
  CompareStockBySymbols,
  EndpointsResponseTypes,
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

      let searchingState = { reading: false, ending: false };
      let stringResult = '{';

      const firstDateToAppearInStream = new Date(to).toISOString().split('T')[0];
      const lastDateToAppearInList = new Date(from).toISOString().split('T')[0];

      historyStream.on('data', (lineBuffer: Buffer) => {
        const line = lineBuffer.toString();

        const hasError = line.includes('Error Message');
        if (hasError) {
          historyStream.pause();
        }

        const foundStartOfWantedInterval: boolean = line.includes(firstDateToAppearInStream) && line.includes('{'); // "date": {

        if (foundStartOfWantedInterval) {
          searchingState.reading = true;
        }

        const isNotUsefull = !searchingState.reading;

        if (isNotUsefull) {
          return;
        }

        const foundEndOfWantedInterval: boolean = line.includes(lastDateToAppearInList) && line.includes('{'); // "date": {

        if (foundEndOfWantedInterval) {
          searchingState.ending = true;
        }

        if (searchingState.reading) {
          stringResult += line;
        }

        const isEndOfTheLastObject: boolean = searchingState.ending && line.includes('},');
        if (isEndOfTheLastObject) {
          //removing last comma
          stringResult = stringResult.slice(0, -1);
          historyStream.pause();
        }
      });

      return new Promise<ControllerSuccess<GetStockHistoryBySymbol> | BaseError[]>((resolve, _) => {
        historyStream.on('pause', () => {
          stringResult += '}';

          const hasError = stringResult === '{}';
          if (hasError) {
            resolve([new NotFoundError({ stock_name })]);
          } else {
            const rawPricesObj = JSON.parse(stringResult);

            const pricesObj: HistoricPrices[] = Object.keys(rawPricesObj).map((key) => {
              const saidObj = rawPricesObj[key];
              return {
                opening: Number(saidObj['1. open']),
                high: Number(saidObj['2. high']),
                low: Number(saidObj['3. low']),
                closing: Number(saidObj['4. close']),
                pricedAt: new Date(key).toISOString(),
              };
            });

            resolve(
              new ControllerSuccess<GetStockHistoryBySymbol>({
                name: stock_name.toUpperCase(),
                prices: pricesObj,
              })
            );
          }
        });
        historyStream.on('end', () => {
          resolve([new NotFoundError({ from }), new NotFoundError({ to })]);
        });
      });
    } catch (error) {
      return this.createErrorObject(new UnknownError());
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
      // The only case where there's two errors is when date is not found (to and from)
      // In that case, im remodeling the error so it doesnt show as a weird "unknown to and from"
      // parameter that the user have never sended.
      const didNotFindDate = todaysValue[0] instanceof NotFoundError && todaysValue.length === 2;
      if (didNotFindDate) {
        return [new NotFoundError({ purchasedAt })];
      }
      return todaysValue;
    }

    if (onDateValue instanceof ControllerSuccess) {
      totalOnDate = onDateValue.getResult().prices[0].closing * Number(purchasedAmount);
    } else {
      //same thing
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
