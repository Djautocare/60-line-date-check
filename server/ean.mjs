export function validEAN13(value) {
    if (!/^\d{13}$/.test(value))
        return false;
    const sum = [...value.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return (10 - sum % 10) % 10 === Number(value[12]);
}
export function validOutcome(status, quantity) {
    return ((status === 'okay' || status === 'rotation_issue' || status === 'off_sale') && quantity === 0) || ((status === 'out_of_date' || status === 'not_stickered') && Number.isInteger(quantity) && Number(quantity) >= 1 && Number(quantity) <= 9999);
}
