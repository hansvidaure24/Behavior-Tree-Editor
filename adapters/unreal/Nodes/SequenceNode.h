#pragma once
#include "BTNode.h"

UCLASS()
class USequenceNode : public UBTNode
{
	GENERATED_BODY()
protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		for (auto* Child : Children)
		{
			EBTNodeStatus Status = Child->Tick(Bb);
			if (Status != EBTNodeStatus::Success)
				return Status;
		}
		return EBTNodeStatus::Success;
	}
};
