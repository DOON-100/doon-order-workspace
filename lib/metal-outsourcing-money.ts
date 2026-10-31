/** Shared by server validation and printed documents. No state or server imports. */
const places=(n:number)=>{const [coefficient,exponent]=String(n).toLowerCase().split('e');return Math.max(0,(coefficient.split('.')[1]||'').length-Number(exponent||0));};
function scaled(n:number){
 if(!Number.isFinite(n)||places(n)>6)throw new RangeError('数量、价格和换算必须是最多6位小数的有限数值。');
 const value=Math.round(n*1e6);if(!Number.isSafeInteger(value))throw new RangeError('数量或价格超出可精确计算的范围。');return BigInt(value);
}
function rounded(n:bigint,d:bigint):bigint{return n<0?-rounded(-n,d):(n+d/BigInt(2))/d;}
/** Quantity-unit amount × pricing units per quantity unit × original unit price. */
export function metalChargeAmount(quantity:number,price:number,factor=1):number{
 if(quantity<0||price<0||factor<=0)throw new RangeError('计费数量和单价不可为负，计价换算须大于0。');
 const cents=rounded(scaled(quantity)*scaled(price)*scaled(factor),BigInt('10000000000000000'));
 if(cents>BigInt('100000000000000'))throw new RangeError('金额超出支持范围。');return Number(cents)/100;
}
/** Inclusive monetary amount to net amount; signed adjustments use half away from zero. */
export function metalNetAmount(gross:number,taxRate:number):number{
 if(!Number.isFinite(gross)||places(gross)>2||taxRate<0||taxRate>1)throw new RangeError('含税金额须精确到分，税率应为0到1的小数。');
 const cents=Math.round(gross*100);if(!Number.isSafeInteger(cents))throw new RangeError('金额超出可精确计算的范围。');
 return Number(rounded(BigInt(cents)*BigInt(1000000),BigInt(1000000)+scaled(taxRate)))/100;
}
