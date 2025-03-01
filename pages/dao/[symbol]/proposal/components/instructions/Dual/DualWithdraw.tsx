/* eslint-disable @typescript-eslint/no-non-null-assertion */
import React, { useContext, useEffect, useState } from 'react'
import { ProgramAccount, Governance } from '@solana/spl-governance'
import {
  UiInstruction,
  DualFinanceWithdrawForm,
} from '@utils/uiTypes/proposalCreationTypes'
import { NewProposalContext } from '../../../new'
import GovernedAccountSelect from '../../GovernedAccountSelect'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import Input from '@components/inputs/Input'
import { getWithdrawInstruction } from '@utils/instructions/Dual'
import useWalletStore from 'stores/useWalletStore'
import { getDualFinanceWithdrawSchema } from '@utils/validations'
import Tooltip from '@components/Tooltip'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'

const DualWithdraw = ({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) => {
  const [form, setForm] = useState<DualFinanceWithdrawForm>({
    soName: undefined,
    baseTreasury: undefined,
    mintPk: undefined,
  })
  const connection = useWalletStore((s) => s.connection)
  const wallet = useWalletOnePointOh()
  const shouldBeGoverned = !!(index !== 0 && governance)
  const { assetAccounts } = useGovernanceAssets()
  const [governedAccount, setGovernedAccount] = useState<
    ProgramAccount<Governance> | undefined
  >(undefined)
  const [formErrors, setFormErrors] = useState({})
  const { handleSetInstructions } = useContext(NewProposalContext)
  const handleSetForm = ({ propertyName, value }) => {
    setFormErrors({})
    setForm({ ...form, [propertyName]: value })
  }
  function getInstruction(): Promise<UiInstruction> {
    return getWithdrawInstruction({
      connection,
      form,
      schema,
      setFormErrors,
      wallet,
    })
  }
  useEffect(() => {
    handleSetInstructions(
      { governedAccount: governedAccount, getInstruction },
      index
    )
  }, [form])
  useEffect(() => {
    handleSetForm({ value: undefined, propertyName: 'mintPk' })
  }, [form.baseTreasury])
  useEffect(() => {
    setGovernedAccount(form.baseTreasury?.governance)
  }, [form.baseTreasury])
  const schema = getDualFinanceWithdrawSchema()

  // TODO: Include this in the config instruction which can optionally be done
  // if the project doesnt need to change where the tokens get returned to.
  return (
    <>
      <Tooltip content="Identifier for the Staking Option">
        <Input
          label="Name"
          value={form.soName}
          type="text"
          onChange={(evt) =>
            handleSetForm({
              value: evt.target.value,
              propertyName: 'soName',
            })
          }
          error={formErrors['soName']}
        />
      </Tooltip>
      <Tooltip content="Treasury owned account receiving the tokens back.">
        <GovernedAccountSelect
          label="Base Treasury"
          governedAccounts={assetAccounts}
          onChange={(value) => {
            handleSetForm({ value, propertyName: 'baseTreasury' })
          }}
          value={form.baseTreasury}
          error={formErrors['baseTreasury']}
          shouldBeGoverned={shouldBeGoverned}
          governance={governance}
          type="token"
        ></GovernedAccountSelect>
      </Tooltip>
      {form.baseTreasury?.isSol && (
        <Input
          label="Mint"
          value={form.mintPk}
          type="text"
          onChange={(evt) =>
            handleSetForm({
              value: evt.target.value,
              propertyName: 'mintPk',
            })
          }
          error={formErrors['mintPk']}
        />
      )}
    </>
  )
}

export default DualWithdraw
