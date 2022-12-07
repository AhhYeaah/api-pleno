import { NotFoundError } from '../../utils/errors/NotFoundError';
import { ControllerSuccess } from '../../utils/types/ControllerResponses/ControllerSuccess';
import { getDefaultResponseForMockedAlphaApiAsObject } from '../utils/mockAlphaService/mockAlphaService';
import { getMoockedApiController } from '../utils/mockApiController';
import { defaultResponseForMockedYahooApi, expectedGainsForDefaultResponse } from '../utils/mockYahooService';

describe('ApiController', () => {
  const moockedController = getMoockedApiController();
  const nonExistentStockName = 'Non Existent';

  test('getStockBySymbol - Should return correctly formated quote', async () => {
    const result = await moockedController.getStockBySymbol('ibm');

    expect(result).toMatchObject(
      new ControllerSuccess({
        name: defaultResponseForMockedYahooApi.symbol,
        lastPrice: defaultResponseForMockedYahooApi.regularMarketPrice,
        pricedAt: new Date(Number(String(new Date('2000-01-01').valueOf()) + '000')).toISOString(),
      })
    );
  });

  test('getStockBySymbol - Should return error if stock cant be found', async () => {
    const result = await moockedController.getStockBySymbol(nonExistentStockName);

    expect(result).toMatchObject([new NotFoundError({ stock_name: nonExistentStockName })]);
  });

  test('compareStockBySymbols - should return array of quotes', async () => {
    const result = await moockedController.compareStockBySymbols('ibm', ['ibm']);

    expect(result).toMatchObject(
      new ControllerSuccess({
        lastPrices: [
          {
            name: defaultResponseForMockedYahooApi.symbol,
            lastPrice: defaultResponseForMockedYahooApi.regularMarketPrice,
            pricedAt: new Date(Number(String(new Date('2000-01-01').valueOf()) + '000')).toISOString(),
          },
          {
            name: defaultResponseForMockedYahooApi.symbol,
            lastPrice: defaultResponseForMockedYahooApi.regularMarketPrice,
            pricedAt: new Date(Number(String(new Date('2000-01-01').valueOf()) + '000')).toISOString(),
          },
        ],
      })
    );
  });

  test('compareStockBySymbols - should return an error if any of the stocks could not be found', async () => {
    const result = await moockedController.compareStockBySymbols(nonExistentStockName, ['ibm', nonExistentStockName]);

    expect(result).toMatchObject([
      new NotFoundError({ stock_name: nonExistentStockName }),
      new NotFoundError({ stock_name: nonExistentStockName }),
    ]);
  });

  test('getStockHistoryBySymbol - should return history array for same date', async () => {
    const result = await moockedController.getStockHistoryBySymbol('ibm', '2022-11-22', '2022-11-22');

    expect(result).toMatchObject({
      result: {
        name: 'IBM',
        prices: [{ closing: 149.1, high: 149.35, low: 147.02, opening: 147.6, pricedAt: '2022-11-22T00:00:00.000Z' }],
      },
    });
  });

  test('getStockHistoryBySymbol - should return history array for different dates', async () => {
    const result = await moockedController.getStockHistoryBySymbol('ibm', '2022-11-21', '2022-11-22');

    expect(result).toMatchObject({
      result: {
        name: 'IBM',
        prices: [
          { closing: 149.1, high: 149.35, low: 147.02, opening: 147.6, pricedAt: '2022-11-22T00:00:00.000Z' },
          { closing: 146.68, high: 147.928, low: 146.45, opening: 147.55, pricedAt: '2022-11-21T00:00:00.000Z' },
        ],
      },
    });
  });

  test('getStockHistoryBySymbol - Regression - should return last object', async () => {
    //this is because it cant read the "}," if object is the last, since it will be replaced
    // by "}"
    const from = '2022-11-18';
    const to = '2022-11-22';
    const result = await moockedController.getStockHistoryBySymbol('ibm', from, to);

    expect(result).toMatchObject({
      result: {
        name: 'IBM',
        prices: [
          { closing: 149.1, high: 149.35, low: 147.02, opening: 147.6, pricedAt: '2022-11-22T00:00:00.000Z' },
          { closing: 146.68, high: 147.928, low: 146.45, opening: 147.55, pricedAt: '2022-11-21T00:00:00.000Z' },
          { closing: 147.64, high: 148.31, low: 145.94, opening: 146.56, pricedAt: '2022-11-18T00:00:00.000Z' },
        ],
      },
    });
  });

  test('getStockHistoryBySymbol - should return error if dates are not found', async () => {
    const from = '2022-11-11';
    const to = '2022-11-15';
    const result = await moockedController.getStockHistoryBySymbol('ibm', from, to);

    expect(result).toMatchObject([new NotFoundError({ from }), new NotFoundError({ to })]);
  });

  test('getStockHistoryBySymbol - should return error if stock_name is not found', async () => {
    const from = '2022-11-18';
    const to = '2022-11-22';
    const stock_name = 'unknown';
    const result = await moockedController.getStockHistoryBySymbol(stock_name, from, to);

    expect(result).toMatchObject([new NotFoundError({ stock_name })]);
  });

  test('projectGains - should return gains', async () => {
    const purchasedAmount = '10';
    const purchasedAt = '2022-11-22';
    const priceAtDate = getDefaultResponseForMockedAlphaApiAsObject()[purchasedAt]['4. close'];

    const result = await moockedController.projectGains('ibm', purchasedAmount, purchasedAt);

    expect(result).toMatchObject({
      result: {
        capitalGains: expectedGainsForDefaultResponse(purchasedAmount, priceAtDate),
        lastPrice: 12.02,
        name: 'IBM',
        priceAtDate: Number(priceAtDate),
        purchasedAmount: 10,
        purchasedAt: '2022-11-22T00:00:00.000Z',
      },
    });
  });

  test('projectGains - should return correct and legible error when date is not found', async () => {
    const purchasedAmount = '10';
    const purchasedAt = '2022-11-25';

    const result = await moockedController.projectGains('ibm', purchasedAmount, purchasedAt);

    expect(result).toMatchObject([new NotFoundError({ purchasedAt })]);
  });
});
