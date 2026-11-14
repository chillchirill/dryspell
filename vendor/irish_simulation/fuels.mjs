export const PUBLISHED_FUELS = {
    'SB-GR1-equivalent-dead': {
        code: 'GR1',
        fineLoadTonAcre: .4,
        characteristicSavPerFt: 2054,
        packingRatio: .00143,
        extinctionMoisture: .15,
        sourcePage: 26
    },
    'SB-GR2-equivalent-dead': {
        code: 'GR2',
        fineLoadTonAcre: 1.1,
        characteristicSavPerFt: 1820,
        packingRatio: .00158,
        extinctionMoisture: .15,
        sourcePage: 27
    },
    'SB-GR3-equivalent-dead': {
        code: 'GR3',
        fineLoadTonAcre: 1.6,
        characteristicSavPerFt: 1290,
        packingRatio: .00143,
        extinctionMoisture: .30,
        sourcePage: 28
    }
};
export function equivalentDeadSpreadMps(fuel, moisture) {
    if (!Number.isFinite(moisture) || moisture < 0) throw new Error('Fuel moisture must be a nonnegative mass ratio');
    const r = moisture / fuel.extinctionMoisture;
    if (r >= 1) return 0;
    const sigma = fuel.characteristicSavPerFt, beta = fuel.packingRatio, betaOpt = 3.348 * sigma ** -.8189, A = 1 / (4.774 * sigma ** .1 - 7.27);
    const gammaMax = sigma ** 1.5 / (495 + .0594 * sigma ** 1.5), gamma = gammaMax * (beta / betaOpt) ** A * Math.exp(A * (1 - beta / betaOpt));
    const moistureDamping = Math.max(0, 1 - 2.59 * r + 5.11 * r * r - 3.52 * r * r * r), mineralDamping = .174 * .01 ** -.19;
    const loadLbFt2 = fuel.fineLoadTonAcre * 2000 / 43560, netLoad = loadLbFt2 / (1 + .0555), reaction = gamma * netLoad * 8000 * moistureDamping * mineralDamping;
    const flux = Math.exp((.792 + .681 * Math.sqrt(sigma)) * (beta + .1)) / (192 + .2595 * sigma), heatSink = beta * 32 * Math.exp(-138 / sigma) * (250 + 1116 * moisture);
    return reaction * flux / heatSink * .3048 / 60;
}
